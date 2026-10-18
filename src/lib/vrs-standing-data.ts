import { findAirportByIcao } from "./airports";
import type { RouteAirport } from "./route-lookup";
import { createTtlCache } from "./ttl-cache";

/**
 * Routes and airports from Virtual Radar Server's standing data, a public
 * domain database the community corrects daily:
 * https://github.com/vradarserver/standing-data
 *
 * Routes come in one file per airline, or for a large airline one per first
 * character of the flight number, so a single download of a hundred or so
 * kilobytes answers every flight of that airline for hours.
 */
const STANDING_DATA_BASE =
  "https://raw.githubusercontent.com/vradarserver/standing-data/main";
const FILE_TIMEOUT_MS = 8_000;
const FILE_TTL_MS = 6 * 60 * 60_000;
const MISSING_FILE_TTL_MS = 60 * 60_000;
/** An airline's ICAO code, then a flight number that starts with a digit. */
const AIRLINE_CALLSIGN = /^([A-Z]{3})([0-9][A-Z0-9]*)$/;
const ICAO_CODE = /^[A-Z0-9]{4}$/;

/** Rows of one file by their key column, or null when the file is absent. */
type StandingDataFile = Map<string, string[]> | null;

const files = createTtlCache<StandingDataFile>(200);
const inflight = new Map<string, Promise<StandingDataFile>>();

/** Splits one CSV line, allowing quoted fields such as "Lydd, Ashford". */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function parseStandingDataCsv(
  text: string,
  keyColumn: string,
): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const key = splitCsvLine(lines[0] ?? "").indexOf(keyColumn);
  if (key < 0) return rows;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const fields = splitCsvLine(line);
    const id = fields[key]?.trim().toUpperCase();
    if (id) rows.set(id, fields);
  }
  return rows;
}

/**
 * Loads one file, keyed by a column. A file that is not there is cached as
 * absent; a failed download throws, so the next lookup tries again.
 */
async function loadFile(
  path: string,
  keyColumn: string,
): Promise<StandingDataFile> {
  const cached = files.get(path);
  if (cached !== undefined) return cached;
  const existing = inflight.get(path);
  if (existing) return existing;

  const request = (async () => {
    try {
      const response = await fetch(`${STANDING_DATA_BASE}/${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
      });
      if (response.status === 404) {
        files.set(path, null, MISSING_FILE_TTL_MS);
        return null;
      }
      if (!response.ok) {
        throw new Error(`Standing data ${path} answered ${response.status}`);
      }
      const rows = parseStandingDataCsv(await response.text(), keyColumn);
      files.set(path, rows, FILE_TTL_MS);
      return rows;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, request);
  return request;
}

export type StandingDataRoute = {
  /** ICAO codes of every airport the flight calls at, in order. */
  airportCodes: string[] | null;
  /** True when the data says there is no route, not that it couldn't load. */
  cacheableMiss: boolean;
};

export async function lookupStandingDataRoute(
  callsign: string,
): Promise<StandingDataRoute> {
  const match = AIRLINE_CALLSIGN.exec(callsign);
  if (!match) return { airportCodes: null, cacheableMiss: true };
  const [, airline, number] = match;
  const folder = `routes/schema-01/${airline[0]}`;

  try {
    const routes =
      (await loadFile(`${folder}/${airline}-all.csv`, "Callsign")) ??
      (await loadFile(`${folder}/${airline}-${number[0]}.csv`, "Callsign"));
    const codes = routes
      ?.get(callsign)?.[4]
      ?.split("-")
      .map((code) => code.trim().toUpperCase());
    if (
      !codes ||
      codes.length < 2 ||
      !codes.every((code) => ICAO_CODE.test(code))
    ) {
      return { airportCodes: null, cacheableMiss: true };
    }
    return { airportCodes: codes, cacheableMiss: true };
  } catch {
    return { airportCodes: null, cacheableMiss: false };
  }
}

function parseCoordinate(
  value: string | undefined,
  limit: number,
): number | null {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) && Math.abs(parsed) <= limit
    ? parsed
    : null;
}

/** An airport's standing data row, or null when it is absent or won't load. */
async function standingDataAirport(icao: string): Promise<string[] | null> {
  try {
    const airports = await loadFile(
      `airports/schema-01/${icao[0]}/${icao.slice(0, 2)}.csv`,
      "ICAO",
    );
    return airports?.get(icao) ?? null;
  } catch {
    return null;
  }
}

/**
 * An airport by ICAO code, named the same way whichever provider reported
 * it. Its name and position come from the app's own airport list where it
 * has the airport. Its place comes from the standing data, which names the
 * city a traveller would, Bucharest rather than Otopeni or Tokyo rather than
 * Narita.
 */
export async function findRouteAirport(
  icao: string,
): Promise<RouteAirport | null> {
  const code = icao.trim().toUpperCase();
  if (!ICAO_CODE.test(code)) return null;
  const local = findAirportByIcao(code);
  // Code, Name, ICAO, IATA, Location, CountryISO2, Latitude, Longitude
  const row = await standingDataAirport(code);
  const place = row?.[4]?.trim();

  if (local) {
    return {
      iata: local.iata,
      icao: local.icao,
      name: local.name,
      municipality: place || local.city,
      countryIso: local.country,
      latitude: local.lat,
      longitude: local.lng,
    };
  }

  const latitude = parseCoordinate(row?.[6], 90);
  const longitude = parseCoordinate(row?.[7], 180);
  if (!row || latitude === null || longitude === null) return null;
  return {
    iata: row[3]?.trim() ?? "",
    icao: code,
    name: row[1]?.trim() ?? "",
    municipality: place ?? "",
    countryIso: row[5]?.trim() ?? "",
    latitude,
    longitude,
  };
}

export function clearStandingDataCache(): void {
  files.clear();
}

import { createHash } from "node:crypto";

import { unzipSync } from "fflate";

export const AVIATION_SCHEMA_VERSION = 1 as const;
export const AIRCRAFT_CHUNK_COUNT = 256;
export const MICRONICS_SOURCE_MASK = 1;
export const FAA_SOURCE_MASK = 2;

export type AircraftSource = "faa" | "mictronics";

export type NormalizedAircraftRecord = {
  icao24: string;
  registration: string | null;
  typeCode: string | null;
  model: string | null;
  manufacturer: string | null;
  registrationCountryCode: string | null;
  databaseFlags: string | null;
  sourceMask: number;
};

export type CompactAircraftRecord = readonly [
  registration: string | null,
  typeCode: string | null,
  model: string | null,
  manufacturer: string | null,
  registrationCountryCode: string | null,
  databaseFlags: string | null,
  sourceMask: number,
];

export type AircraftChunk = {
  schemaVersion: typeof AVIATION_SCHEMA_VERSION;
  records: Record<string, CompactAircraftRecord>;
};

export type AviationAirportRecord = {
  id: number;
  ident: string;
  type: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationFt: number | null;
  countryCode: string | null;
  municipality: string | null;
  icao: string | null;
  iata: string | null;
};

export type SourceManifestEntry = {
  url: string;
  sha256: string;
  publishedAt: string | null;
  license: string;
  licenseUrl: string;
  attribution: string;
  records: number;
};

export type AviationDataManifest = {
  schemaVersion: typeof AVIATION_SCHEMA_VERSION;
  dataDate: string | null;
  sources: {
    mictronics: SourceManifestEntry;
    faa: SourceManifestEntry;
    ourairports: SourceManifestEntry;
  };
  files: {
    aircraft: Record<string, { sha256: string; records: number }>;
    airports: { sha256: string; records: number };
  };
  counts: {
    aircraft: number;
    airports: number;
  };
  privacy: {
    includedAircraftFields: string[];
    excludedFaaFields: string[];
  };
};

type MictronicsValue = {
  r?: unknown;
  t?: unknown;
  f?: unknown;
  desc?: unknown;
};

const REGISTRATION_PREFIXES: readonly [string, string][] = [
  ["A6-", "AE"],
  ["A7-", "QA"],
  ["AP-", "PK"],
  ["C-", "CA"],
  ["CS-", "PT"],
  ["D-", "DE"],
  ["EC-", "ES"],
  ["EI-", "IE"],
  ["F-", "FR"],
  ["G-", "GB"],
  ["HA-", "HU"],
  ["HB-", "CH"],
  ["HL", "KR"],
  ["HS-", "TH"],
  ["HZ-", "SA"],
  ["I-", "IT"],
  ["JA", "JP"],
  ["LN-", "NO"],
  ["LV-", "AR"],
  ["N", "US"],
  ["OE-", "AT"],
  ["OH-", "FI"],
  ["OK-", "CZ"],
  ["OO-", "BE"],
  ["OY-", "DK"],
  ["PH-", "NL"],
  ["PK-", "ID"],
  ["PP-", "BR"],
  ["PR-", "BR"],
  ["PS-", "BR"],
  ["PT-", "BR"],
  ["PU-", "BR"],
  ["RA-", "RU"],
  ["SE-", "SE"],
  ["SP-", "PL"],
  ["SU-", "EG"],
  ["SX-", "GR"],
  ["TC-", "TR"],
  ["UR-", "UA"],
  ["VH-", "AU"],
  ["VP-", "BM"],
  ["VT", "IN"],
  ["XA-", "MX"],
  ["XB-", "MX"],
  ["XC-", "MX"],
  ["YR-", "RO"],
  ["ZK-", "NZ"],
  ["ZS-", "ZA"],
  ["ZT-", "ZA"],
  ["ZU-", "ZA"],
  ["3B-", "MU"],
  ["3C-", "GQ"],
  ["3D-", "SZ"],
  ["3X-", "GN"],
  ["4K-", "AZ"],
  ["4L-", "GE"],
  ["4R-", "LK"],
  ["4X-", "IL"],
  ["5B-", "CY"],
  ["5H-", "TZ"],
  ["5N-", "NG"],
  ["5R-", "MG"],
  ["5X-", "UG"],
  ["6V-", "SN"],
  ["7O-", "YE"],
  ["7T-", "DZ"],
  ["8P-", "BB"],
  ["8Q-", "MV"],
  ["9A-", "HR"],
  ["9G-", "GH"],
  ["9H-", "MT"],
  ["9J-", "ZM"],
  ["9K-", "KW"],
  ["9M-", "MY"],
  ["9N-", "NP"],
  ["9V-", "SG"],
  ["B-", "CN"],
];

const SORTED_REGISTRATION_PREFIXES = [...REGISTRATION_PREFIXES].sort(
  (left, right) => right[0].length - left[0].length,
);

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\u2014/g, "-");
  return clean || null;
}

export function registrationCountryCode(
  registration: string | null,
): string | null {
  if (!registration) return null;
  const normalized = registration.trim().toUpperCase();
  for (const [prefix, countryCode] of SORTED_REGISTRATION_PREFIXES) {
    if (normalized.startsWith(prefix)) return countryCode;
  }
  return null;
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function* iterateCsvRows(text: string): Generator<string[]> {
  let field = "";
  let row: string[] = [];
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; index < text.length; index++) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) yield row;
      row = [];
      continue;
    }

    field += character;
  }

  if (quoted) throw new Error("CSV data has an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function headerIndexes(
  header: string[],
  required: readonly string[],
): Map<string, number> {
  const indexes = new Map(
    header.map((value, index) => [value.trim().toUpperCase(), index]),
  );
  for (const field of required) {
    if (!indexes.has(field)) throw new Error(`CSV data is missing ${field}`);
  }
  return indexes;
}

function cell(
  row: string[],
  indexes: Map<string, number>,
  field: string,
): string {
  return row[indexes.get(field) ?? -1]?.trim().replace(/\u2014/g, "-") ?? "";
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

export function normalizeMictronicsAircraft(
  archive: Uint8Array,
  minimumRecords = 100_000,
): Map<string, NormalizedAircraftRecord> {
  const files = unzipSync(archive, {
    filter: ({ name }) => name.toLowerCase().endsWith(".json"),
  });
  const aircraft = new Map<string, NormalizedAircraftRecord>();

  for (const fileName of Object.keys(files).sort()) {
    const prefix = fileName.replace(/\.json$/i, "").toLowerCase();
    if (!/^[0-9a-f]{1,5}$/.test(prefix)) {
      throw new Error(`Mictronics archive has an invalid file name: ${fileName}`);
    }

    const parsed = JSON.parse(decodeText(files[fileName])) as Record<
      string,
      MictronicsValue
    >;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Mictronics file has an invalid object: ${fileName}`);
    }

    for (const suffix of Object.keys(parsed).sort()) {
      if (suffix === "children") {
        if (
          !Array.isArray(parsed[suffix]) ||
          !(parsed[suffix] as unknown[]).every(
            (value) => typeof value === "string",
          )
        ) {
          throw new Error(`Mictronics child index is invalid: ${fileName}`);
        }
        continue;
      }
      const icao24 = `${prefix}${suffix}`.toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(icao24)) {
        throw new Error(`Mictronics file has an invalid ICAO address: ${icao24}`);
      }

      const value = parsed[suffix];
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Mictronics record is invalid: ${icao24}`);
      }

      const registration = cleanString(value.r)?.toUpperCase() ?? null;
      aircraft.set(icao24, {
        icao24,
        registration,
        typeCode: cleanString(value.t)?.toUpperCase() ?? null,
        model: cleanString(value.desc),
        manufacturer: null,
        registrationCountryCode: registrationCountryCode(registration),
        databaseFlags: cleanString(value.f)?.toUpperCase() ?? null,
        sourceMask: MICRONICS_SOURCE_MASK,
      });
    }
  }

  if (aircraft.size < minimumRecords) {
    throw new Error(`Mictronics record count is too small: ${aircraft.size}`);
  }
  return aircraft;
}

function parseFaaAircraftReferences(text: string, minimumRecords: number): Map<
  string,
  { manufacturer: string | null; model: string | null }
> {
  const rows = iterateCsvRows(text);
  const first = rows.next();
  if (first.done) throw new Error("FAA ACFTREF file is empty");
  const indexes = headerIndexes(first.value, ["CODE", "MFR", "MODEL"]);
  const references = new Map<
    string,
    { manufacturer: string | null; model: string | null }
  >();

  for (const row of rows) {
    const code = cell(row, indexes, "CODE");
    if (!code) continue;
    references.set(code, {
      manufacturer: cleanString(cell(row, indexes, "MFR")),
      model: cleanString(cell(row, indexes, "MODEL")),
    });
  }
  if (references.size < minimumRecords) {
    throw new Error(`FAA aircraft reference count is too small: ${references.size}`);
  }
  return references;
}

export function mergeFaaAircraft(
  archive: Uint8Array,
  aircraft: Map<string, NormalizedAircraftRecord>,
  minimumRecords = 100_000,
): number {
  const files = unzipSync(archive, {
    filter: ({ name }) => name === "MASTER.txt" || name === "ACFTREF.txt",
  });
  if (!files["MASTER.txt"] || !files["ACFTREF.txt"]) {
    throw new Error("FAA archive does not contain MASTER.txt and ACFTREF.txt");
  }

  const references = parseFaaAircraftReferences(
    decodeText(files["ACFTREF.txt"]),
    Math.min(1_000, minimumRecords),
  );
  const rows = iterateCsvRows(decodeText(files["MASTER.txt"]));
  const first = rows.next();
  if (first.done) throw new Error("FAA MASTER file is empty");
  const indexes = headerIndexes(first.value, [
    "N-NUMBER",
    "MFR MDL CODE",
    "MODE S CODE HEX",
  ]);
  let count = 0;

  for (const row of rows) {
    const icao24 = cell(row, indexes, "MODE S CODE HEX").toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(icao24)) continue;
    const nNumber = cell(row, indexes, "N-NUMBER").replace(/\s+/g, "");
    if (!/^[0-9A-Z]+$/i.test(nNumber)) continue;

    const current = aircraft.get(icao24);
    const reference = references.get(cell(row, indexes, "MFR MDL CODE"));
    aircraft.set(icao24, {
      icao24,
      registration: `N${nNumber.toUpperCase()}`,
      typeCode: current?.typeCode ?? null,
      model: reference?.model ?? current?.model ?? null,
      manufacturer: reference?.manufacturer ?? current?.manufacturer ?? null,
      registrationCountryCode: "US",
      databaseFlags: current?.databaseFlags ?? null,
      sourceMask: (current?.sourceMask ?? 0) | FAA_SOURCE_MASK,
    });
    count++;
  }

  if (count < minimumRecords) {
    throw new Error(`FAA record count is too small: ${count}`);
  }
  return count;
}

export function normalizeAirports(
  csv: string,
  minimumRecords = 5_000,
): AviationAirportRecord[] {
  const rows = iterateCsvRows(csv);
  const first = rows.next();
  if (first.done) throw new Error("OurAirports file is empty");
  const indexes = headerIndexes(first.value, [
    "ID",
    "IDENT",
    "TYPE",
    "NAME",
    "LATITUDE_DEG",
    "LONGITUDE_DEG",
    "ELEVATION_FT",
    "ISO_COUNTRY",
    "MUNICIPALITY",
    "ICAO_CODE",
    "IATA_CODE",
  ]);
  const airports: AviationAirportRecord[] = [];

  for (const row of rows) {
    if (cell(row, indexes, "TYPE") === "closed") continue;
    const id = Number.parseInt(cell(row, indexes, "ID"), 10);
    const latitude = Number.parseFloat(cell(row, indexes, "LATITUDE_DEG"));
    const longitude = Number.parseFloat(cell(row, indexes, "LONGITUDE_DEG"));
    const elevationValue = cell(row, indexes, "ELEVATION_FT");
    const elevationFt = elevationValue
      ? Number.parseFloat(elevationValue)
      : null;
    const ident = cell(row, indexes, "IDENT").toUpperCase();

    if (
      !Number.isInteger(id) ||
      !ident ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      (elevationFt !== null && !Number.isFinite(elevationFt))
    ) {
      throw new Error(`OurAirports record is invalid: ${ident || id}`);
    }

    const countryCode = cell(row, indexes, "ISO_COUNTRY").toUpperCase();
    const icao = cell(row, indexes, "ICAO_CODE").toUpperCase();
    const iata = cell(row, indexes, "IATA_CODE").toUpperCase();
    airports.push({
      id,
      ident,
      type: cell(row, indexes, "TYPE"),
      name: cell(row, indexes, "NAME"),
      latitude,
      longitude,
      elevationFt,
      countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
      municipality: cleanString(cell(row, indexes, "MUNICIPALITY")),
      icao: /^[A-Z0-9]{4}$/.test(icao) ? icao : null,
      iata: /^[A-Z0-9]{3}$/.test(iata) ? iata : null,
    });
  }

  airports.sort(
    (left, right) =>
      left.ident.localeCompare(right.ident) || left.id - right.id,
  );
  if (airports.length < minimumRecords) {
    throw new Error(`OurAirports record count is too small: ${airports.length}`);
  }
  return airports;
}

export function compactAircraftRecord(
  record: NormalizedAircraftRecord,
): CompactAircraftRecord {
  return [
    record.registration,
    record.typeCode,
    record.model,
    record.manufacturer,
    record.registrationCountryCode,
    record.databaseFlags,
    record.sourceMask,
  ];
}

export function createAircraftChunks(
  aircraft: Map<string, NormalizedAircraftRecord>,
): Map<string, AircraftChunk> {
  const chunks = new Map<string, AircraftChunk>();
  for (let index = 0; index < AIRCRAFT_CHUNK_COUNT; index++) {
    const prefix = index.toString(16).padStart(2, "0");
    chunks.set(prefix, {
      schemaVersion: AVIATION_SCHEMA_VERSION,
      records: {},
    });
  }

  for (const icao24 of [...aircraft.keys()].sort()) {
    const record = aircraft.get(icao24);
    if (!record) continue;
    const chunk = chunks.get(icao24.slice(0, 2));
    if (!chunk) throw new Error(`Aircraft prefix is invalid: ${icao24}`);
    chunk.records[icao24] = compactAircraftRecord(record);
  }
  return chunks;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function sourceNamesFromMask(mask: number): AircraftSource[] {
  const sources: AircraftSource[] = [];
  if ((mask & FAA_SOURCE_MASK) !== 0) sources.push("faa");
  if ((mask & MICRONICS_SOURCE_MASK) !== 0) sources.push("mictronics");
  return sources;
}

export function validateCompactAircraftRecord(
  icao24: string,
  value: unknown,
): asserts value is CompactAircraftRecord {
  if (!Array.isArray(value) || value.length !== 7) {
    throw new Error(`Aircraft record has an invalid shape: ${icao24}`);
  }
  for (let index = 0; index < 6; index++) {
    if (value[index] !== null && typeof value[index] !== "string") {
      throw new Error(`Aircraft record has an invalid field: ${icao24}`);
    }
  }
  if (!Number.isInteger(value[6]) || value[6] < 1 || value[6] > 3) {
    throw new Error(`Aircraft record has invalid sources: ${icao24}`);
  }
  const countryCode = value[4];
  if (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error(`Aircraft record has an invalid country: ${icao24}`);
  }
}

export function validateCountChange(
  label: string,
  previousCount: number | undefined,
  nextCount: number,
): void {
  if (!previousCount || previousCount <= 0) return;
  const minimum = Math.floor(previousCount * 0.9);
  if (nextCount < minimum) {
    throw new Error(
      `${label} record count fell from ${previousCount} to ${nextCount}`,
    );
  }
}

export function normalizePublishedAt(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function latestSourceDate(
  entries: readonly SourceManifestEntry[],
): string | null {
  const dates = entries
    .map((entry) => entry.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates.at(-1) ?? null;
}

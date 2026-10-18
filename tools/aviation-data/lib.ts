import { createHash } from "node:crypto";

import { unzipSync } from "fflate";

import {
  AVIATION_SCHEMA_VERSION,
  FAA_SOURCE_MASK,
  MICTRONICS_SOURCE_MASK,
  type AircraftChunk,
  type CompactAircraftRecord,
} from "../../src/lib/aircraft-registry-format";

/** Buckets above this size are split by the third hex digit. */
export const CHUNK_SPLIT_THRESHOLD = 4_000;

export type NormalizedAircraftRecord = {
  icao24: string;
  registration: string | null;
  typeCode: string | null;
  model: string | null;
  manufacturer: string | null;
  databaseFlags: string | null;
  sourceMask: number;
};

export type SourceManifestEntry = {
  url: string;
  sha256: string;
  /** When this exact source file was first downloaded. */
  retrievedAt: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  records: number;
};

export type AviationDataManifest = {
  schemaVersion: typeof AVIATION_SCHEMA_VERSION;
  dataDate: string;
  sources: {
    mictronics: SourceManifestEntry;
    faa: SourceManifestEntry;
  };
  files: Record<string, { sha256: string; records: number }>;
  counts: { aircraft: number };
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

const ICAO24_PATTERN = /^[0-9a-f]{6}$/;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
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
  return row[indexes.get(field) ?? -1]?.trim() ?? "";
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
      // Index files list the deeper prefix files instead of holding records.
      if (suffix === "children") continue;

      const icao24 = `${prefix}${suffix}`.toLowerCase();
      if (!ICAO24_PATTERN.test(icao24)) {
        throw new Error(`Mictronics file has an invalid ICAO address: ${icao24}`);
      }

      const value = parsed[suffix];
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Mictronics record is invalid: ${icao24}`);
      }

      aircraft.set(icao24, {
        icao24,
        registration: cleanString(value.r)?.toUpperCase() ?? null,
        typeCode: cleanString(value.t)?.toUpperCase() ?? null,
        model: cleanString(value.desc),
        manufacturer: null,
        databaseFlags: cleanString(value.f)?.toUpperCase() ?? null,
        sourceMask: MICTRONICS_SOURCE_MASK,
      });
    }
  }

  if (aircraft.size < minimumRecords) {
    throw new Error(`Mictronics record count is too small: ${aircraft.size}`);
  }
  return aircraft;
}

function parseFaaAircraftReferences(
  text: string,
  minimumRecords: number,
): Map<string, { manufacturer: string | null; model: string | null }> {
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

/**
 * Overlays FAA registration, manufacturer, and model onto the Mictronics
 * records. Only these columns are read, so owner names and addresses in
 * MASTER.txt never reach the output.
 */
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
    if (!ICAO24_PATTERN.test(icao24)) continue;
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

export function compactAircraftRecord(
  record: NormalizedAircraftRecord,
): CompactAircraftRecord {
  return [
    record.registration,
    record.typeCode,
    record.model,
    record.manufacturer,
    record.databaseFlags,
    record.sourceMask,
  ];
}

/**
 * Groups records by the first two hex digits of the address, splitting any
 * group above the threshold by the third digit. Empty chunks are omitted.
 * Output order is sorted, so the same input always serializes the same way.
 */
export function createAircraftChunks(
  aircraft: Map<string, NormalizedAircraftRecord>,
  splitThreshold = CHUNK_SPLIT_THRESHOLD,
): Map<string, AircraftChunk> {
  const groups = new Map<string, string[]>();
  for (const icao24 of [...aircraft.keys()].sort()) {
    const prefix = icao24.slice(0, 2);
    const group = groups.get(prefix);
    if (group) group.push(icao24);
    else groups.set(prefix, [icao24]);
  }

  const chunks = new Map<string, AircraftChunk>();
  for (const [prefix, addresses] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const split = addresses.length > splitThreshold;
    for (const icao24 of addresses) {
      const id = split ? icao24.slice(0, 3) : prefix;
      let chunk = chunks.get(id);
      if (!chunk) {
        chunk = { schemaVersion: AVIATION_SCHEMA_VERSION, records: {} };
        chunks.set(id, chunk);
      }
      chunk.records[icao24] = compactAircraftRecord(aircraft.get(icao24)!);
    }
  }
  return chunks;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
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

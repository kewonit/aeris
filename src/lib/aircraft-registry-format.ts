// Shared by the data generator in tools/aviation-data and the browser
// registry client, so both read and write one record shape.

export const AVIATION_SCHEMA_VERSION = 2 as const;
export const MICTRONICS_SOURCE_MASK = 1;
export const FAA_SOURCE_MASK = 2;

export type AircraftRegistrySource = "faa" | "mictronics";

export type CompactAircraftRecord = readonly [
  registration: string | null,
  typeCode: string | null,
  model: string | null,
  manufacturer: string | null,
  databaseFlags: string | null,
  sourceMask: number,
];

export type AircraftChunk = {
  schemaVersion: typeof AVIATION_SCHEMA_VERSION;
  records: Record<string, CompactAircraftRecord>;
};

/** Lists every chunk file. A chunk id is a two or three digit hex prefix. */
export type AircraftChunkIndex = {
  schemaVersion: typeof AVIATION_SCHEMA_VERSION;
  chunks: string[];
};

const CHUNK_ID_PATTERN = /^[0-9a-f]{2,3}$/;

export function isCompactAircraftRecord(
  value: unknown,
): value is CompactAircraftRecord {
  if (!Array.isArray(value) || value.length !== 6) return false;
  for (let index = 0; index < 5; index++) {
    if (value[index] !== null && typeof value[index] !== "string") return false;
  }
  const sourceMask = value[5];
  return Number.isInteger(sourceMask) && sourceMask >= 1 && sourceMask <= 3;
}

export function isAircraftChunk(value: unknown): value is AircraftChunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const chunk = value as Partial<AircraftChunk>;
  return (
    chunk.schemaVersion === AVIATION_SCHEMA_VERSION &&
    !!chunk.records &&
    typeof chunk.records === "object" &&
    !Array.isArray(chunk.records) &&
    Object.values(chunk.records).every(isCompactAircraftRecord)
  );
}

export function isAircraftChunkIndex(
  value: unknown,
): value is AircraftChunkIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const index = value as Partial<AircraftChunkIndex>;
  return (
    index.schemaVersion === AVIATION_SCHEMA_VERSION &&
    Array.isArray(index.chunks) &&
    index.chunks.every(
      (id) => typeof id === "string" && CHUNK_ID_PATTERN.test(id),
    )
  );
}

/** Returns the longest chunk id that prefixes the address, if any. */
export function chunkIdForAddress(
  icao24: string,
  chunkIds: ReadonlySet<string>,
): string | null {
  const long = icao24.slice(0, 3);
  if (chunkIds.has(long)) return long;
  const short = icao24.slice(0, 2);
  return chunkIds.has(short) ? short : null;
}

export function sourceNamesFromMask(mask: number): AircraftRegistrySource[] {
  const sources: AircraftRegistrySource[] = [];
  if ((mask & FAA_SOURCE_MASK) !== 0) sources.push("faa");
  if ((mask & MICTRONICS_SOURCE_MASK) !== 0) sources.push("mictronics");
  return sources;
}

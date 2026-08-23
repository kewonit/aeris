export type AircraftRegistrySource = "faa" | "mictronics";

export type AircraftRegistryRecord = {
  icao24: string;
  registration: string | null;
  typeCode: string | null;
  model: string | null;
  manufacturer: string | null;
  registrationCountry: string | null;
  registrationCountryCode: string | null;
  registrationCountryFlag: string | null;
  databaseFlags: string | null;
  sources: AircraftRegistrySource[];
};

type CompactAircraftRecord = readonly [
  registration: string | null,
  typeCode: string | null,
  model: string | null,
  manufacturer: string | null,
  registrationCountryCode: string | null,
  databaseFlags: string | null,
  sourceMask: number,
];

type AircraftChunk = {
  schemaVersion: 1;
  records: Record<string, CompactAircraftRecord>;
};

const ICAO24_PATTERN = /^[0-9a-f]{6}$/;
const chunkCache = new Map<string, Promise<AircraftChunk>>();
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function isCompactRecord(value: unknown): value is CompactAircraftRecord {
  if (!Array.isArray(value) || value.length !== 7) return false;
  for (let index = 0; index < 6; index++) {
    if (value[index] !== null && typeof value[index] !== "string") return false;
  }
  return Number.isInteger(value[6]) && value[6] >= 1 && value[6] <= 3;
}

function parseChunk(value: unknown): AircraftChunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Aircraft registry chunk has an invalid shape");
  }
  const chunk = value as Partial<AircraftChunk>;
  if (
    chunk.schemaVersion !== 1 ||
    !chunk.records ||
    typeof chunk.records !== "object" ||
    Array.isArray(chunk.records)
  ) {
    throw new Error("Aircraft registry chunk has an invalid shape");
  }
  for (const record of Object.values(chunk.records)) {
    if (!isCompactRecord(record)) {
      throw new Error("Aircraft registry record has an invalid shape");
    }
  }
  return chunk as AircraftChunk;
}

async function loadChunk(prefix: string): Promise<AircraftChunk> {
  const cached = chunkCache.get(prefix);
  if (cached) return cached;

  const request = fetch(`/data/aviation/aircraft/${prefix}.json`, {
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Aircraft registry returned HTTP ${response.status}`);
      }
      return parseChunk(await response.json());
    })
    .catch((error) => {
      chunkCache.delete(prefix);
      throw error;
    });
  chunkCache.set(prefix, request);
  return request;
}

function sourceNames(sourceMask: number): AircraftRegistrySource[] {
  const sources: AircraftRegistrySource[] = [];
  if ((sourceMask & 2) !== 0) sources.push("faa");
  if ((sourceMask & 1) !== 0) sources.push("mictronics");
  return sources;
}

function countryName(countryCode: string | null): string | null {
  if (!countryCode) return null;
  const name = regionNames.of(countryCode);
  return name && name !== countryCode ? name : null;
}

function countryFlag(countryCode: string | null): string | null {
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return null;
  return String.fromCodePoint(
    ...[...countryCode].map((character) => character.charCodeAt(0) + 127397),
  );
}

export async function lookupAircraftRegistry(
  icao24: string,
  signal?: AbortSignal,
): Promise<AircraftRegistryRecord | null> {
  const normalized = icao24.trim().toLowerCase();
  if (!ICAO24_PATTERN.test(normalized)) return null;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const chunk = await loadChunk(normalized.slice(0, 2));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const record = chunk.records[normalized];
  if (!record) return null;

  return {
    icao24: normalized,
    registration: record[0],
    typeCode: record[1],
    model: record[2],
    manufacturer: record[3],
    registrationCountry: countryName(record[4]),
    registrationCountryCode: record[4],
    registrationCountryFlag: countryFlag(record[4]),
    databaseFlags: record[5],
    sources: sourceNames(record[6]),
  };
}

export function clearAircraftRegistryCacheForTests(): void {
  chunkCache.clear();
}

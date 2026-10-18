import {
  chunkIdForAddress,
  isAircraftChunk,
  isAircraftChunkIndex,
  sourceNamesFromMask,
  type AircraftChunk,
  type AircraftRegistrySource,
} from "./aircraft-registry-format";
import { countryFlagEmoji, registrationCountry } from "./registration-country";

export type { AircraftRegistrySource };

export type AircraftRegistryRecord = {
  icao24: string;
  registration: string | null;
  typeCode: string | null;
  model: string | null;
  manufacturer: string | null;
  registrationCountry: string | null;
  registrationCountryFlag: string | null;
  databaseFlags: string | null;
  sources: AircraftRegistrySource[];
};

const BASE_PATH = "/data/aviation/aircraft";
const MAX_CACHED_CHUNKS = 8;
const ICAO24_PATTERN = /^[0-9a-f]{6}$/;

let indexRequest: Promise<ReadonlySet<string>> | null = null;
const chunkCache = new Map<string, Promise<AircraftChunk>>();

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Aircraft registry returned HTTP ${response.status}`);
  }
  return response.json();
}

function loadIndex(): Promise<ReadonlySet<string>> {
  indexRequest ??= fetchJson(`${BASE_PATH}/index.json`)
    .then((value) => {
      if (!isAircraftChunkIndex(value)) {
        throw new Error("Aircraft registry index has an invalid shape");
      }
      return new Set(value.chunks);
    })
    .catch((error) => {
      indexRequest = null;
      throw error;
    });
  return indexRequest;
}

function loadChunk(id: string): Promise<AircraftChunk> {
  const cached = chunkCache.get(id);
  if (cached) {
    // Re-insert to mark the chunk as recently used.
    chunkCache.delete(id);
    chunkCache.set(id, cached);
    return cached;
  }

  const request = fetchJson(`${BASE_PATH}/${id}.json`)
    .then((value) => {
      if (!isAircraftChunk(value)) {
        throw new Error("Aircraft registry chunk has an invalid shape");
      }
      return value;
    })
    .catch((error) => {
      chunkCache.delete(id);
      throw error;
    });
  chunkCache.set(id, request);
  if (chunkCache.size > MAX_CACHED_CHUNKS) {
    chunkCache.delete(chunkCache.keys().next().value!);
  }
  return request;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export async function lookupAircraftRegistry(
  icao24: string,
  signal?: AbortSignal,
): Promise<AircraftRegistryRecord | null> {
  const normalized = icao24.trim().toLowerCase();
  if (!ICAO24_PATTERN.test(normalized)) return null;
  throwIfAborted(signal);

  const chunkId = chunkIdForAddress(normalized, await loadIndex());
  throwIfAborted(signal);
  if (!chunkId) return null;

  const record = (await loadChunk(chunkId)).records[normalized];
  throwIfAborted(signal);
  if (!record) return null;

  const [registration, typeCode, model, manufacturer, databaseFlags, mask] =
    record;
  const country = registrationCountry(registration);
  return {
    icao24: normalized,
    registration,
    typeCode,
    model,
    manufacturer,
    registrationCountry: country?.name ?? null,
    registrationCountryFlag: countryFlagEmoji(country?.code ?? null),
    databaseFlags,
    sources: sourceNamesFromMask(mask),
  };
}

export function clearAircraftRegistryCacheForTests(): void {
  indexRequest = null;
  chunkCache.clear();
}

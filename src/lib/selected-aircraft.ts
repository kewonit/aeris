import type { AircraftRegistryRecord } from "./aircraft-registry";
import { lookupAircraftRegistry } from "./aircraft-registry";
import { fetchFlightByHex } from "./flight-api-client";
import type { FlightState } from "./opensky-types";
import { createTtlCache } from "./ttl-cache";

const CACHE_TTL_MS = 30_000;

export type SelectedAircraftSources = {
  icao24: string;
  /** A one-off lookup of this aircraft, taken when it was selected. */
  fresh: FlightState | null;
  registry: AircraftRegistryRecord | null;
};

type SourceLoaders = {
  fetchFresh: (icao24: string, signal?: AbortSignal) => Promise<FlightState | null>;
  lookupRegistry: typeof lookupAircraftRegistry;
};

const defaultLoaders: SourceLoaders = {
  fetchFresh: async (icao24, signal) =>
    (await fetchFlightByHex(icao24, signal)).flight,
  lookupRegistry: lookupAircraftRegistry,
};

const cache = createTtlCache<SelectedAircraftSources>(50);

function observationTime(flight: FlightState): number {
  const { observationTime, positionAgeSeconds, responseTime } =
    flight.provenance;
  if (observationTime !== null) return observationTime;
  if (positionAgeSeconds !== null) return responseTime - positionAgeSeconds * 1000;
  return responseTime;
}

function qualityTuple(flight: FlightState): [number, number, number] {
  return [
    flight.debugData?.nacP ?? -1,
    flight.debugData?.nic ?? -1,
    flight.positionSource === "adsb" ? 1 : 0,
  ];
}

function compareQuality(left: FlightState, right: FlightState): number {
  const leftQuality = qualityTuple(left);
  const rightQuality = qualityTuple(right);
  for (let index = 0; index < leftQuality.length; index++) {
    if (leftQuality[index] !== rightQuality[index]) {
      return leftQuality[index] - rightQuality[index];
    }
  }
  return 0;
}

/**
 * Picks the newer of two states for the same aircraft. Within two seconds
 * of each other, the more precise position wins instead.
 */
export function selectCoherentFlightState(
  current: FlightState,
  fresh: FlightState | null,
): FlightState {
  if (!fresh) return current;
  const currentTime = observationTime(current);
  const freshTime = observationTime(fresh);
  if (Math.abs(freshTime - currentTime) <= 2_000) {
    const quality = compareQuality(fresh, current);
    if (quality !== 0) return quality > 0 ? fresh : current;
  }
  return freshTime >= currentTime ? fresh : current;
}

/**
 * Merges the live state with the selection lookup and the registry. Live
 * fields (position, callsign, type description) come from whichever state
 * is newer, so they keep following the feed after the lookup ages.
 * Registry fields describe the airframe and win over feed values.
 */
export function fuseSelectedAircraft(
  current: FlightState,
  fresh: FlightState | null,
  registry: AircraftRegistryRecord | null,
): FlightState {
  const live = selectCoherentFlightState(current, fresh);
  const other = live === current ? fresh : current;

  return {
    ...live,
    callsign: live.callsign ?? other?.callsign ?? null,
    typeDescription: live.typeDescription ?? other?.typeDescription ?? null,
    registration:
      registry?.registration ?? live.registration ?? other?.registration,
    typeCode: registry?.typeCode ?? live.typeCode ?? other?.typeCode,
    model: registry?.model ?? live.model ?? other?.model ?? null,
    manufacturer:
      registry?.manufacturer ?? live.manufacturer ?? other?.manufacturer ?? null,
    registrationCountry:
      registry?.registrationCountry ??
      live.registrationCountry ??
      other?.registrationCountry ??
      null,
    registrationCountryFlag:
      registry?.registrationCountryFlag ??
      live.registrationCountryFlag ??
      other?.registrationCountryFlag ??
      null,
    provenance: {
      ...live.provenance,
      contributingSources: [
        ...new Set([
          ...current.provenance.contributingSources,
          ...(fresh?.provenance.contributingSources ?? []),
          ...(registry?.sources ?? []),
        ]),
      ],
    },
  };
}

export async function loadSelectedAircraftSources(
  icao24: string,
  signal?: AbortSignal,
  loaders: SourceLoaders = defaultLoaders,
): Promise<SelectedAircraftSources> {
  const normalized = icao24.trim().toLowerCase();
  const cached = cache.get(normalized);
  if (cached) return cached;

  const [fresh, registry] = await Promise.allSettled([
    loaders.fetchFresh(normalized, signal),
    loaders.lookupRegistry(normalized, signal),
  ]);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const sources: SelectedAircraftSources = {
    icao24: normalized,
    fresh: fresh.status === "fulfilled" ? fresh.value : null,
    registry: registry.status === "fulfilled" ? registry.value : null,
  };
  // A failed lookup is not cached, so the next selection retries it.
  if (fresh.status === "fulfilled" && registry.status === "fulfilled") {
    cache.set(normalized, sources, CACHE_TTL_MS);
  }
  return sources;
}

export function clearSelectedAircraftCacheForTests(): void {
  cache.clear();
}

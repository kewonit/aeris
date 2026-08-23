import type { AircraftRegistryRecord } from "./aircraft-registry";
import { lookupAircraftRegistry } from "./aircraft-registry";
import { fetchSelectedAircraftFromAdsbLol } from "./flight-api-client";
import type { FlightState } from "./opensky-types";

const SELECTED_AIRCRAFT_CACHE_TTL_MS = 30_000;

export type SelectedAircraftSources = {
  icao24: string;
  fresh: FlightState | null;
  registry: AircraftRegistryRecord | null;
  fetchedAt: number;
};

export type SelectedAircraftFusionResult = {
  flight: FlightState;
  registry: AircraftRegistryRecord | null;
  contributingSources: string[];
  fusedAt: number;
};

type SelectedAircraftCacheEntry = {
  expiresAt: number;
  sources: SelectedAircraftSources;
};

const selectedAircraftCache = new Map<string, SelectedAircraftCacheEntry>();

function observationTime(flight: FlightState): number {
  const provenance = flight.provenance;
  if (provenance.observationTime !== null) return provenance.observationTime;
  if (provenance.positionAgeSeconds !== null) {
    return provenance.responseTime - provenance.positionAgeSeconds * 1000;
  }
  return provenance.responseTime;
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

function uniqueSources(...groups: (readonly string[] | undefined)[]): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))];
}

export function fuseSelectedAircraft(
  current: FlightState,
  fresh: FlightState | null,
  registry: AircraftRegistryRecord | null,
  fusedAt = Date.now(),
): SelectedAircraftFusionResult {
  const position = selectCoherentFlightState(current, fresh);
  const sources = uniqueSources(
    current.provenance.contributingSources,
    fresh?.provenance.contributingSources,
    registry?.sources,
  );

  const flight: FlightState = {
    ...position,
    callsign: fresh?.callsign ?? current.callsign,
    registration:
      registry?.registration ?? fresh?.registration ?? current.registration,
    typeCode: registry?.typeCode ?? fresh?.typeCode ?? current.typeCode,
    typeDescription:
      fresh?.typeDescription ?? current.typeDescription ?? null,
    model: registry?.model ?? fresh?.model ?? current.model ?? null,
    manufacturer:
      registry?.manufacturer ??
      fresh?.manufacturer ??
      current.manufacturer ??
      null,
    registrationCountry:
      registry?.registrationCountry ??
      fresh?.registrationCountry ??
      current.registrationCountry,
    registrationCountryCode:
      registry?.registrationCountryCode ??
      fresh?.registrationCountryCode ??
      current.registrationCountryCode ??
      null,
    registrationCountryFlag:
      registry?.registrationCountryFlag ??
      fresh?.registrationCountryFlag ??
      current.registrationCountryFlag ??
      null,
    provenance: {
      responseTime: position.provenance.responseTime,
      observationTime: position.provenance.observationTime,
      positionAgeSeconds: position.provenance.positionAgeSeconds,
      contributingSources: sources,
      positionProvider: position.provenance.positionProvider,
    },
  };

  return { flight, registry, contributingSources: sources, fusedAt };
}

export async function loadSelectedAircraftSources(
  icao24: string,
  signal?: AbortSignal,
  dependencies: {
    fetchFresh?: typeof fetchSelectedAircraftFromAdsbLol;
    lookupRegistry?: typeof lookupAircraftRegistry;
    now?: () => number;
  } = {},
): Promise<SelectedAircraftSources> {
  const normalized = icao24.trim().toLowerCase();
  const now = dependencies.now ?? Date.now;
  const cached = selectedAircraftCache.get(normalized);
  if (cached && now() < cached.expiresAt) return cached.sources;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const fetchFresh = dependencies.fetchFresh ?? fetchSelectedAircraftFromAdsbLol;
  const lookupRegistry = dependencies.lookupRegistry ?? lookupAircraftRegistry;
  const [freshResult, registryResult] = await Promise.allSettled([
    fetchFresh(normalized, signal),
    lookupRegistry(normalized, signal),
  ]);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const fetchedAt = now();
  const sources: SelectedAircraftSources = {
    icao24: normalized,
    fresh: freshResult.status === "fulfilled" ? freshResult.value : null,
    registry:
      registryResult.status === "fulfilled" ? registryResult.value : null,
    fetchedAt,
  };
  selectedAircraftCache.set(normalized, {
    expiresAt: fetchedAt + SELECTED_AIRCRAFT_CACHE_TTL_MS,
    sources,
  });
  return sources;
}

export function clearSelectedAircraftCacheForTests(): void {
  selectedAircraftCache.clear();
}

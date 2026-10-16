import type { FlightProvenance } from "./opensky-types";

const SECONDS_TIMESTAMP_LIMIT = 10_000_000_000;

export function normalizeFlightTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(
    value < SECONDS_TIMESTAMP_LIMIT ? value * 1000 : value,
  );
}

/**
 * Builds provenance from whichever timing the provider reports: readsb
 * gives the position age, OpenSky gives the observation time. The missing
 * value is derived from the other.
 */
export function createFlightProvenance({
  positionProvider,
  responseTime,
  observationTime,
  positionAgeSeconds,
}: {
  positionProvider: string;
  responseTime: unknown;
  observationTime?: unknown;
  positionAgeSeconds?: unknown;
}): FlightProvenance {
  const response = normalizeFlightTimestamp(responseTime) ?? Date.now();
  const age =
    typeof positionAgeSeconds === "number" &&
    Number.isFinite(positionAgeSeconds) &&
    positionAgeSeconds >= 0
      ? positionAgeSeconds
      : null;
  const observed =
    normalizeFlightTimestamp(observationTime) ??
    (age !== null ? Math.round(response - age * 1000) : null);
  const provider = positionProvider.trim() || "unknown";

  return {
    responseTime: response,
    observationTime: observed,
    positionAgeSeconds:
      age ?? (observed !== null ? Math.max(0, (response - observed) / 1000) : null),
    contributingSources: [provider],
    positionProvider: provider,
  };
}

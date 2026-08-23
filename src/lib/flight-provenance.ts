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
  const normalizedResponseTime =
    normalizeFlightTimestamp(responseTime) ?? Date.now();
  const normalizedObservationTime = normalizeFlightTimestamp(observationTime);
  const explicitAge =
    typeof positionAgeSeconds === "number" &&
    Number.isFinite(positionAgeSeconds) &&
    positionAgeSeconds >= 0
      ? positionAgeSeconds
      : null;
  const derivedAge =
    normalizedObservationTime !== null
      ? Math.max(0, (normalizedResponseTime - normalizedObservationTime) / 1000)
      : null;
  const provider = positionProvider.trim() || "unknown";

  return {
    responseTime: normalizedResponseTime,
    observationTime: normalizedObservationTime,
    positionAgeSeconds: explicitAge ?? derivedAge,
    contributingSources: [provider],
    positionProvider: provider,
  };
}

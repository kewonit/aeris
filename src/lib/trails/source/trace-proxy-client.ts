import type { FlightTrack } from "@/lib/opensky";

import type { TrailOutcome, TrailProviderId } from "../types";

export type ProxyTracePayload = {
  hex: string;
  track: FlightTrack | null;
  source: TrailProviderId | null;
  outcome: TrailOutcome;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
};

function createFallbackPayload(
  icao24: string,
  outcome: TrailOutcome,
): ProxyTracePayload {
  return {
    hex: icao24.trim().toLowerCase(),
    track: null,
    source: null,
    outcome,
    creditsRemaining: null,
    retryAfterSeconds: null,
  };
}

function isTrailOutcome(value: unknown): value is TrailOutcome {
  return (
    value === "full-history" ||
    value === "partial-history" ||
    value === "live-tail-only" ||
    value === "rate-limited" ||
    value === "provider-unavailable"
  );
}

function isTrailProviderId(value: unknown): value is TrailProviderId {
  return (
    value === "live" ||
    value === "adsb-fi" ||
    value === "adsb-lol" ||
    value === "airplanes-live" ||
    value === "opensky"
  );
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isValidFlightTrack(value: unknown): value is FlightTrack {
  if (value == null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.icao24 !== "string") return false;
  if (typeof obj.startTime !== "number" || !Number.isFinite(obj.startTime))
    return false;
  if (typeof obj.endTime !== "number" || !Number.isFinite(obj.endTime))
    return false;
  if (!Array.isArray(obj.path)) return false;
  return true;
}

function normalizeProxyTracePayload(
  icao24: string,
  payload: unknown,
  fallbackOutcome: TrailOutcome,
): ProxyTracePayload {
  const fallback = createFallbackPayload(icao24, fallbackOutcome);

  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const data = payload as Record<string, unknown>;

  return {
    hex:
      typeof data.hex === "string" && data.hex.trim().length > 0
        ? data.hex.trim().toLowerCase()
        : fallback.hex,
    track:
      data.track === null
        ? null
        : isValidFlightTrack(data.track)
          ? data.track
          : null,
    source: isTrailProviderId(data.source) ? data.source : fallback.source,
    outcome: isTrailOutcome(data.outcome) ? data.outcome : fallback.outcome,
    creditsRemaining: normalizeNumber(data.creditsRemaining),
    retryAfterSeconds: normalizeNumber(data.retryAfterSeconds),
  };
}

export async function fetchTraceViaProxy(
  icao24: string,
  signal?: AbortSignal,
): Promise<ProxyTracePayload> {
  const normalizedIcao24 = icao24.trim().toLowerCase();
  const response = await fetch(
    `/api/flights/trace?hex=${encodeURIComponent(normalizedIcao24)}`,
    {
      cache: "no-store",
      signal,
    },
  );

  const fallbackOutcome: TrailOutcome =
    response.status === 429 ? "rate-limited" : "provider-unavailable";
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType && !contentType.includes("application/json")) {
    return createFallbackPayload(normalizedIcao24, fallbackOutcome);
  }

  try {
    const payload = await response.json();
    return normalizeProxyTracePayload(
      normalizedIcao24,
      payload,
      fallbackOutcome,
    );
  } catch {
    return createFallbackPayload(normalizedIcao24, fallbackOutcome);
  }
}

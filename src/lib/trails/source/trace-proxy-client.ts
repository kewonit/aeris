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

export async function fetchTraceViaProxy(
  icao24: string,
  signal?: AbortSignal,
): Promise<ProxyTracePayload> {
  const response = await fetch(
    `/api/flights/trace?hex=${encodeURIComponent(icao24.trim().toLowerCase())}`,
    {
      cache: "no-store",
      signal,
    },
  );

  return (await response.json()) as ProxyTracePayload;
}

import {
  getDirectTraceProviderPolicies,
  getTraceProviderPolicy,
  type TraceProviderId,
} from "../providers";
import type { FlightTrack } from "@/lib/opensky";

import { parseReadsbTraces } from "./parse-readsb-trace";

function isAbortError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "AbortError";
}

export function getDirectTraceProviders(): TraceProviderId[] {
  if (process.env.NEXT_PUBLIC_AUTHORIZED_DIRECT_FLIGHT_DATA !== "true") {
    return [];
  }
  return getDirectTraceProviderPolicies().map((provider) => provider.id);
}

export function buildReadsbTraceUrls(
  provider: TraceProviderId,
  icao24: string,
): string[] {
  const policy = getTraceProviderPolicy(provider);
  if (!policy.supportsBrowserDirect) {
    throw new Error(
      `Provider is not configured for browser-direct fetch: ${provider}`,
    );
  }

  const normalized = icao24.trim().toLowerCase();
  const suffix = normalized.slice(-2);

  return [
    `${policy.baseUrl}/${suffix}/trace_full_${normalized}.json`,
    `${policy.baseUrl}/${suffix}/trace_recent_${normalized}.json`,
  ];
}

/** The JSON body of a trace file, or null when it is missing or unreadable. */
async function fetchTracePayload(
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html") || contentType.includes("text/xml")) {
      return null;
    }

    return (await response.json()) as unknown;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return null;
  }
}

/**
 * Fetches trace_full and trace_recent together and merges them, because
 * trace_full lags by minutes and trace_recent alone covers only the end.
 */
export async function fetchReadsbDirectTrack(
  provider: TraceProviderId,
  icao24: string,
  signal?: AbortSignal,
): Promise<{
  track: FlightTrack | null;
  outcome: "full-history" | "partial-history" | "provider-unavailable";
}> {
  const [fullUrl, recentUrl] = buildReadsbTraceUrls(provider, icao24);
  const [full, recent] = await Promise.all([
    fetchTracePayload(fullUrl, signal),
    fetchTracePayload(recentUrl, signal),
  ]);

  const track = parseReadsbTraces(icao24, [full, recent]);
  if (!track) {
    return { track: null, outcome: "provider-unavailable" };
  }

  return {
    track,
    outcome: full != null ? "full-history" : "partial-history",
  };
}

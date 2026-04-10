import {
  getDirectTraceProviderPolicies,
  getTraceProviderPolicy,
  type TraceProviderId,
} from "../providers";
import type { FlightTrack } from "@/lib/opensky";

import { parseReadsbTrace } from "./parse-readsb-trace";

function isAbortError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "AbortError";
}

export function getDirectTraceProviders(): TraceProviderId[] {
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

export function getResponseValidators(headers: Headers): {
  etag: string | null;
  lastModified: string | null;
} {
  return {
    etag: headers.get("etag"),
    lastModified: headers.get("last-modified"),
  };
}

export async function fetchReadsbDirectTrack(
  provider: TraceProviderId,
  icao24: string,
  signal?: AbortSignal,
): Promise<{
  track: FlightTrack | null;
  outcome: "full-history" | "partial-history" | "provider-unavailable";
}> {
  const urls = buildReadsbTraceUrls(provider, icao24);

  for (let index = 0; index < urls.length; index += 1) {
    let response: Response | null = null;

    try {
      response = await fetch(urls[index], {
        cache: "no-store",
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      continue;
    }

    if (!response?.ok) {
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html") || contentType.includes("text/xml")) {
      continue;
    }

    try {
      const payload = (await response.json()) as unknown;
      const track = parseReadsbTrace(icao24, payload);
      if (track?.path.length && track.path.length >= 2) {
        return {
          track,
          outcome: index === 0 ? "full-history" : "partial-history",
        };
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      continue;
    }
  }

  return {
    track: null,
    outcome: "provider-unavailable",
  };
}

// ── Global Flight Search Client ────────────────────────────────────────
//
// Searches live aircraft globally by callsign or ICAO24 hex.
// Uses the existing server proxy (/api/flights) with adsb.lol fallback chain.
//
// Verified endpoints (actual API docs):
//   adsb.lol:     https://api.adsb.lol/v2/callsign/{callsign}
//                 https://api.adsb.lol/v2/hex/{icao_hex}
//   airplanes.live: https://api.airplanes.live/v2/callsign/{callsign}
//                   https://api.airplanes.live/v2/hex/{hex}
//
// Rate limits enforced server-side by the proxy.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "./opensky-types";
import type { ReadsbApiResponse } from "./flight-api-types";
import { parseAircraftList, type ParseOptions } from "./flight-api-parsing";

const SEARCH_TIMEOUT_MS = 10_000;
const DEFAULT_PARSE_OPTS: ParseOptions = {
  includeGround: true,
  requireBaroAltitude: false,
};

// ── Client-Side Cache ──────────────────────────────────────────────────

interface CacheEntry {
  flights: FlightState[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 8_000; // 8 seconds - flights move fast
const CACHE_MAX_ENTRIES = 30;

function cacheKey(query: string): string {
  return query.trim().toUpperCase().replace(/\s+/g, "");
}

function getCached(query: string): FlightState[] | undefined {
  const key = cacheKey(query);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.flights;
}

function setCached(query: string, flights: FlightState[]): void {
  const key = cacheKey(query);
  // Evict oldest if at capacity
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { flights, ts: Date.now() });
}

// ── Search ─────────────────────────────────────────────────────────────

/**
 * Search for live flights globally by callsign or ICAO24 hex address.
 * Returns parsed FlightState[] from the first provider that responds.
 *
 * @param query  Callsign (e.g. "UAL123") or ICAO24 hex (e.g. "a1b2c3")
 * @param signal AbortSignal for cancellation
 */
export async function searchFlightsGlobal(
  query: string,
  signal?: AbortSignal,
): Promise<FlightState[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  // Check cache first
  const cached = getCached(normalized);
  if (cached) return cached;

  const compact = normalized.toLowerCase().replace(/\s+/g, "");

  // Determine if hex or callsign
  const isHex = /^[0-9a-f]{6}$/i.test(compact);
  const path = isHex
    ? `/hex/${compact.toLowerCase()}`
    : `/callsign/${compact.toUpperCase()}`;

  if (signal?.aborted) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`/api/flights?path=${encodeURIComponent(path)}`, {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 429) {
        // Rate limited - return empty, let UI handle retry
        return [];
      }
      return [];
    }

    const data: unknown = await res.json();

    // Validate readsb response shape
    const response = data as ReadsbApiResponse;
    if (!response || !Array.isArray(response.ac)) {
      return [];
    }

    const flights = parseAircraftList(response.ac, DEFAULT_PARSE_OPTS);
    setCached(normalized, flights);
    return flights;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return [];
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Clear the flight search cache (e.g. on manual refresh).
 */
export function clearFlightSearchCache(): void {
  cache.clear();
}

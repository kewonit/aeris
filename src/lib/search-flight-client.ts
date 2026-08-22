// ── Global Flight Search Client ────────────────────────────────────────
//
// Searches live aircraft globally by callsign or ICAO24 hex.
// Uses the shared provider chain and circuit state used by map/flight lookups.
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
import {
  fetchFlightsByCallsign,
  fetchFlightsByHex,
  getProviderOverride,
  type ProviderName,
} from "./flight-api-client";
import { expandFlightQuery } from "./airlines";

const SEARCH_TIMEOUT_MS = 10_000;

// ── Client-Side Cache ──────────────────────────────────────────────────

interface CacheEntry {
  flights: FlightState[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 8_000; // 8 seconds for hits - flights move fast
const CACHE_EMPTY_TTL_MS = 2_000; // 2 seconds for misses - don't block long
const CACHE_MAX_ENTRIES = 30;

function cacheKey(query: string, provider: ProviderName): string {
  const normalized = query.trim().toUpperCase().replace(/\s+/g, "");
  return `${provider}:${normalized}`;
}

function getCached(
  query: string,
  provider: ProviderName,
): FlightState[] | undefined {
  const key = cacheKey(query, provider);
  const entry = cache.get(key);
  if (!entry) return undefined;
  const ttl = entry.flights.length === 0 ? CACHE_EMPTY_TTL_MS : CACHE_TTL_MS;
  if (Date.now() - entry.ts > ttl) {
    cache.delete(key);
    return undefined;
  }
  return entry.flights;
}

function setCached(
  query: string,
  provider: ProviderName,
  flights: FlightState[],
): void {
  const key = cacheKey(query, provider);
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
async function fetchFlightsByPath(
  path: string,
  signal?: AbortSignal,
): Promise<FlightState[]> {
  if (signal?.aborted) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const hexMatch = path.match(/^\/hex\/([0-9a-f]{6})$/i);
    if (hexMatch) {
      return (await fetchFlightsByHex(hexMatch[1], controller.signal)).flights;
    }

    const callsignMatch = path.match(/^\/callsign\/([A-Z0-9-]{1,8})$/i);
    if (callsignMatch) {
      return (
        await fetchFlightsByCallsign(callsignMatch[1], controller.signal)
      ).flights;
    }

    return [];
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return [];
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function searchFlightsGlobal(
  query: string,
  signal?: AbortSignal,
): Promise<FlightState[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const provider = getProviderOverride();

  // Check cache first
  const cached = getCached(normalized, provider);
  if (cached) return cached;

  const compact = normalized.toLowerCase().replace(/\s+/g, "");

  const allFlights: FlightState[] = [];
  const seenIcao24 = new Set<string>();
  function addUnique(flights: FlightState[]) {
    for (const f of flights) {
      if (!seenIcao24.has(f.icao24)) {
        seenIcao24.add(f.icao24);
        allFlights.push(f);
      }
    }
  }

  // ── Phase 1: Generate all query variants (IATA ↔ ICAO translations) ──
  //
  // ADS-B transponders broadcast ICAO callsigns (e.g. AXB2680) but users
  // search by IATA flight numbers (e.g. IX2680).  We must try every variant.
  //
  // Also: some 6-char queries look like hex but are actually callsigns
  // (e.g. "IX2680", "AA1234").  We cannot short-circuit to hex lookup.
  const variants = expandFlightQuery(normalized);
  const rawCompact = compact.toUpperCase();
  if (!variants.includes(rawCompact)) {
    variants.unshift(rawCompact);
  }

  for (const variant of variants) {
    if (signal?.aborted) break;
    const vCompact = variant.toLowerCase();
    const vHex = /^[0-9a-f]{6}$/i.test(vCompact);

    if (vHex) {
      const hexResults = await fetchFlightsByPath(
        `/hex/${vCompact}`,
        signal,
      );
      addUnique(hexResults);
    } else {
      const csResults = await fetchFlightsByPath(
        `/callsign/${variant.toUpperCase()}`,
        signal,
      );
      addUnique(csResults);
    }

    // Stop early once we have results
    if (allFlights.length > 0) break;
  }

  // ── Phase 2: Callsign fallback for truly ambiguous hex queries ──────
  //
  // If the original compact query is 6 hex chars and we still have no
  // results, try the opposite endpoint of what we already attempted.
  if (allFlights.length === 0 && !signal?.aborted) {
    const isHex = /^[0-9a-f]{6}$/i.test(compact);
    if (isHex) {
      // Already tried hex above; the same six characters may be a callsign.
      const csResults = await fetchFlightsByPath(
        `/callsign/${compact.toUpperCase()}`,
        signal,
      );
      addUnique(csResults);
    }
  }

  setCached(normalized, provider, allFlights);
  return allFlights;
}

/**
 * Clear the flight search cache (e.g. on manual refresh).
 */
export function clearFlightSearchCache(): void {
  cache.clear();
}

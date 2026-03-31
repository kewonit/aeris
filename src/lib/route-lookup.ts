// ── Route Lookup Service ─────────────────────────────────────────────
//
// Resolves callsign → origin/destination using free external APIs.
//
// Data flow (waterfall):
//   1. Check in-memory FIFO cache
//   2. Deduplicate in-flight requests
//   3. adsbdb.com (rich data: full airport objects + airline info)
//   4. hexdb.io fallback (lightweight: "EGLL-OTHH" string)
//   5. Return null on miss (caller falls back to heuristic estimation)
//
// adsbdb.com is free, requires no API key, and returns CORS: *.
// hexdb.io does NOT return CORS headers, so it is proxied through
// our server at /api/hexdb to avoid browser CORS errors.
//
// Verified March 2026:
//   - adsbdb.com: https://www.adsbdb.com/ — rate limit 60 req / 60s rolling
//   - hexdb.io:   https://hexdb.io/       — proxied via /api/hexdb
// ────────────────────────────────────────────────────────────────────────

// ── Types ──────────────────────────────────────────────────────────────

export type RouteAirport = {
  /** IATA code, e.g. "LHR" */
  iata: string;
  /** ICAO code, e.g. "EGLL" */
  icao: string;
  /** Airport name, e.g. "London Heathrow Airport" */
  name: string;
  /** City/municipality, e.g. "London" */
  municipality: string;
  /** ISO country code, e.g. "GB" */
  countryIso: string;
  /** Latitude in degrees */
  latitude: number;
  /** Longitude in degrees */
  longitude: number;
};

export type RouteInfo = {
  /** The callsign this route was looked up for */
  callsign: string;
  /** Origin airport */
  origin: RouteAirport | null;
  /** Destination airport */
  destination: RouteAirport | null;
  /** Data source that resolved this route */
  source: "adsbdb" | "hexdb" | "departure-detection" | "estimation";
  /** When this entry was fetched (for TTL) */
  fetchedAt: number;
};

// ── Constants ──────────────────────────────────────────────────────────

const ADSBDB_BASE = "https://api.adsbdb.com/v0";
/** hexdb.io is proxied through our server to avoid CORS errors */
const HEXDB_PROXY = "/api/hexdb";

/** Cache successful lookups for 15 minutes */
const CACHE_HIT_TTL_MS = 15 * 60_000;
/** Cache misses (404/unknown) for 2 minutes to avoid hammering */
const CACHE_MISS_TTL_MS = 2 * 60_000;
/** Maximum cache entries */
const CACHE_MAX_ENTRIES = 300;

/** Minimum interval between requests to any single API (ms) */
const MIN_REQUEST_INTERVAL_MS = 500;
/** Request timeout */
const FETCH_TIMEOUT_MS = 8_000;

/** Callsign validation: 1–8 alphanumeric characters (ICAO standard) */
const CALLSIGN_RE = /^[A-Z0-9]{1,8}$/i;

// ── Cache ──────────────────────────────────────────────────────────────

type CacheEntry = {
  route: RouteInfo | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function cacheGet(callsign: string): RouteInfo | null | undefined {
  const key = callsign.toUpperCase();
  const entry = cache.get(key);
  if (!entry) return undefined; // not in cache
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.route; // could be null (cached miss)
}

function cacheSet(callsign: string, route: RouteInfo | null): void {
  const key = callsign.toUpperCase();
  const ttl = route ? CACHE_HIT_TTL_MS : CACHE_MISS_TTL_MS;
  cache.set(key, { route, expiresAt: Date.now() + ttl });

  // Evict oldest entries if over limit
  if (cache.size > CACHE_MAX_ENTRIES) {
    const it = cache.keys();
    const first = it.next();
    if (!first.done) cache.delete(first.value);
  }
}

// ── Request deduplication ──────────────────────────────────────────────

const inflight = new Map<string, Promise<RouteInfo | null>>();

// ── Rate limiting (concurrency-safe with per-source promise queues) ────

let lastAdsbdbRequest = 0;
let lastHexdbRequest = 0;
let adsbdbQueue: Promise<void> = Promise.resolve();
let hexdbQueue: Promise<void> = Promise.resolve();

async function rateLimitedFetch(
  url: string,
  source: "adsbdb" | "hexdb",
  signal?: AbortSignal,
): Promise<Response> {
  const previousQueue = source === "adsbdb" ? adsbdbQueue : hexdbQueue;
  let releaseQueue: () => void;
  const currentQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  if (source === "adsbdb") {
    adsbdbQueue = previousQueue.then(() => currentQueue);
  } else {
    hexdbQueue = previousQueue.then(() => currentQueue);
  }

  await previousQueue;

  try {
    const now = Date.now();
    const lastRef = source === "adsbdb" ? lastAdsbdbRequest : lastHexdbRequest;
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRef));

    if (wait > 0) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, wait);
        signal?.addEventListener("abort", onAbort);
      });
    }

    if (source === "adsbdb") lastAdsbdbRequest = Date.now();
    else lastHexdbRequest = Date.now();

    return fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    releaseQueue!();
  }
}

// ── adsbdb.com Parser ──────────────────────────────────────────────────

type AdsbdbAirport = {
  country_iso_name?: string;
  country_name?: string;
  elevation?: number;
  iata_code?: string;
  icao_code?: string;
  latitude?: number;
  longitude?: number;
  municipality?: string;
  name?: string;
};

function parseAdsbdbAirport(
  raw: AdsbdbAirport | null | undefined,
): RouteAirport | null {
  if (!raw) return null;
  const iata = raw.iata_code?.trim();
  const icao = raw.icao_code?.trim();
  if (!iata && !icao) return null;

  return {
    iata: iata ?? "",
    icao: icao ?? "",
    name: raw.name?.trim() ?? "",
    municipality: raw.municipality?.trim() ?? "",
    countryIso: raw.country_iso_name?.trim() ?? "",
    latitude:
      typeof raw.latitude === "number" && Number.isFinite(raw.latitude)
        ? raw.latitude
        : 0,
    longitude:
      typeof raw.longitude === "number" && Number.isFinite(raw.longitude)
        ? raw.longitude
        : 0,
  };
}

async function fetchFromAdsbdb(
  callsign: string,
  signal?: AbortSignal,
): Promise<RouteInfo | null> {
  try {
    // Always use the callsign-only endpoint — the combined endpoint
    // (/aircraft/{hex}?callsign={cs}) returns 404 when the hex isn't
    // in adsbdb's aircraft database, even if the callsign has a known
    // route, causing most lookups to fail silently.
    const url = `${ADSBDB_BASE}/callsign/${encodeURIComponent(callsign)}`;

    const res = await rateLimitedFetch(url, "adsbdb", signal);

    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) return null;

    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return null;

    const resp = (data as Record<string, unknown>).response;
    if (typeof resp !== "object" || resp === null) return null;

    // "unknown callsign" returns { response: "unknown callsign" }
    if (typeof resp === "string") return null;

    const respObj = resp as Record<string, unknown>;

    let origin: RouteAirport | null = null;
    let destination: RouteAirport | null = null;

    // Route data is nested under flightroute
    const flightroute = respObj.flightroute;
    if (typeof flightroute === "object" && flightroute !== null) {
      const fr = flightroute as Record<string, unknown>;
      origin = parseAdsbdbAirport(fr.origin as AdsbdbAirport | null);
      destination = parseAdsbdbAirport(fr.destination as AdsbdbAirport | null);
    }

    if (!origin && !destination) return null;

    return {
      callsign,
      origin,
      destination,
      source: "adsbdb",
      fetchedAt: Date.now(),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return null;
  }
}

// ── hexdb.io Parser ────────────────────────────────────────────────────

async function fetchFromHexdb(
  callsign: string,
  signal?: AbortSignal,
): Promise<RouteInfo | null> {
  try {
    const res = await rateLimitedFetch(
      `${HEXDB_PROXY}?path=route/icao/${encodeURIComponent(callsign)}`,
      "hexdb",
      signal,
    );

    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return null;

    const obj = data as Record<string, unknown>;
    const route = typeof obj.route === "string" ? obj.route.trim() : null;

    // Route format: "EGLL-OTHH" (ICAO codes separated by dash)
    if (!route || !route.includes("-")) return null;

    const parts = route.split("-");
    if (parts.length < 2) return null;

    const originIcao = parts[0].trim();
    const destIcao = parts[parts.length - 1].trim();

    if (!originIcao || !destIcao) return null;

    // hexdb.io also has airport info endpoint — fetch details for both
    const [originDetail, destDetail] = await Promise.all([
      fetchHexdbAirport(originIcao, signal),
      fetchHexdbAirport(destIcao, signal),
    ]);

    return {
      callsign,
      origin: originDetail ?? {
        iata: "",
        icao: originIcao,
        name: "",
        municipality: "",
        countryIso: "",
        latitude: 0,
        longitude: 0,
      },
      destination: destDetail ?? {
        iata: "",
        icao: destIcao,
        name: "",
        municipality: "",
        countryIso: "",
        latitude: 0,
        longitude: 0,
      },
      source: "hexdb",
      fetchedAt: Date.now(),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return null;
  }
}

async function fetchHexdbAirport(
  icao: string,
  signal?: AbortSignal,
): Promise<RouteAirport | null> {
  try {
    const res = await rateLimitedFetch(
      `${HEXDB_PROXY}?path=airport/icao/${encodeURIComponent(icao)}`,
      "hexdb",
      signal,
    );

    if (!res.ok) return null;

    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return null;

    const obj = data as Record<string, unknown>;

    return {
      iata: typeof obj.iata === "string" ? obj.iata.trim() : "",
      icao: typeof obj.icao === "string" ? obj.icao.trim() : icao,
      name: typeof obj.airport === "string" ? obj.airport.trim() : "",
      municipality: "",
      countryIso:
        typeof obj.country_code === "string" ? obj.country_code.trim() : "",
      latitude:
        typeof obj.latitude === "number" && Number.isFinite(obj.latitude)
          ? obj.latitude
          : 0,
      longitude:
        typeof obj.longitude === "number" && Number.isFinite(obj.longitude)
          ? obj.longitude
          : 0,
    };
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Look up the route (origin → destination) for a callsign.
 *
 * Uses a waterfall strategy:
 *   1. In-memory LRU cache
 *   2. adsbdb.com (rich airport + airline data; callsign-based lookup)
 *   3. hexdb.io (lightweight fallback)
 *
 * Returns null if the callsign is invalid, unrecognized, or both APIs fail.
 * Results are cached (15min hits, 2min misses) and requests are deduplicated.
 */
export async function lookupRoute(
  callsign: string | null | undefined,
  signal?: AbortSignal,
): Promise<RouteInfo | null> {
  // Validate callsign
  if (!callsign) return null;
  const normalized = callsign.trim().toUpperCase();
  if (!normalized || !CALLSIGN_RE.test(normalized)) return null;

  // 1. Check cache
  const cached = cacheGet(normalized);
  if (cached !== undefined) return cached;

  // 2. Deduplicate in-flight requests
  const existing = inflight.get(normalized);
  if (existing) return existing;

  // 3. Execute lookup
  const promise = (async (): Promise<RouteInfo | null> => {
    try {
      // Try adsbdb first (richer data)
      const adsbdbResult = await fetchFromAdsbdb(normalized, signal);
      if (adsbdbResult) {
        cacheSet(normalized, adsbdbResult);
        return adsbdbResult;
      }

      // Fallback to hexdb
      const hexdbResult = await fetchFromHexdb(normalized, signal);
      if (hexdbResult) {
        cacheSet(normalized, hexdbResult);
        return hexdbResult;
      }

      // Both failed — cache as miss
      cacheSet(normalized, null);
      return null;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      // Don't cache errors — allow retry
      return null;
    } finally {
      inflight.delete(normalized);
    }
  })();

  inflight.set(normalized, promise);
  return promise;
}

/**
 * Clear all cached route data. Useful when switching cities or
 * on long-running sessions.
 */
export function clearRouteCache(): void {
  cache.clear();
  // Don't clear inflight — let pending requests complete
}

/**
 * Format a RouteAirport for display.
 * Returns the most meaningful short identifier:
 *   IATA code (e.g. "LHR") if available, otherwise ICAO (e.g. "EGLL").
 */
export function formatAirportCode(airport: RouteAirport | null): string {
  if (!airport) return "";
  return airport.iata || airport.icao || "";
}

/**
 * Format a RouteAirport for display with city name.
 * Returns e.g. "London Heathrow (LHR)" or "EGLL" as fallback.
 */
export function formatAirportFull(airport: RouteAirport | null): string {
  if (!airport) return "";
  const code = airport.iata || airport.icao;
  if (!code) return airport.name || "";
  if (airport.name) return `${airport.name} (${code})`;
  if (airport.municipality) return `${airport.municipality} (${code})`;
  return code;
}

// Route Lookup Client
//
// Client-side callers resolve route data through Aeris' own /api/routes
// endpoint. The server endpoint owns external provider validation, rate
// limiting, cache headers, and upstream normalization.

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
  source: "adsbdb" | "hexdb";
  /** When this entry was fetched (for TTL) */
  fetchedAt: number;
};

const CACHE_HIT_TTL_MS = 15 * 60_000;
const CACHE_MISS_TTL_MS = 2 * 60_000;
const CACHE_MAX_ENTRIES = 300;
const CALLSIGN_RE = /^[A-Z0-9]{1,8}$/i;

type CacheEntry = {
  route: RouteInfo | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RouteInfo | null>>();

function normalizeCallsign(callsign: string | null | undefined): string | null {
  if (!callsign) return null;
  const normalized = callsign.trim().toUpperCase();
  return normalized && CALLSIGN_RE.test(normalized) ? normalized : null;
}

function cacheGet(callsign: string): RouteInfo | null | undefined {
  const entry = cache.get(callsign);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(callsign);
    return undefined;
  }
  return entry.route;
}

function cacheSet(callsign: string, route: RouteInfo | null): void {
  cache.set(callsign, {
    route,
    expiresAt: Date.now() + (route ? CACHE_HIT_TTL_MS : CACHE_MISS_TTL_MS),
  });

  if (cache.size > CACHE_MAX_ENTRIES) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
}

function isRouteAirport(value: unknown): value is RouteAirport {
  if (typeof value !== "object" || value === null) return false;
  const airport = value as Record<string, unknown>;
  return (
    typeof airport.iata === "string" &&
    typeof airport.icao === "string" &&
    typeof airport.name === "string" &&
    typeof airport.municipality === "string" &&
    typeof airport.countryIso === "string" &&
    typeof airport.latitude === "number" &&
    Number.isFinite(airport.latitude) &&
    typeof airport.longitude === "number" &&
    Number.isFinite(airport.longitude)
  );
}

function parseRouteInfo(value: unknown): RouteInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const route = value as Record<string, unknown>;

  if (typeof route.callsign !== "string") return null;
  if (route.source !== "adsbdb" && route.source !== "hexdb") return null;
  if (
    typeof route.fetchedAt !== "number" ||
    !Number.isFinite(route.fetchedAt)
  ) {
    return null;
  }

  const origin = route.origin === null ? null : route.origin;
  const destination = route.destination === null ? null : route.destination;

  if (origin !== null && !isRouteAirport(origin)) return null;
  if (destination !== null && !isRouteAirport(destination)) return null;
  if (origin === null && destination === null) return null;

  return {
    callsign: route.callsign,
    origin,
    destination,
    source: route.source,
    fetchedAt: route.fetchedAt,
  };
}

export async function lookupRoute(
  callsign: string | null | undefined,
  signal?: AbortSignal,
): Promise<RouteInfo | null> {
  const normalized = normalizeCallsign(callsign);
  if (!normalized) return null;

  const cached = cacheGet(normalized);
  if (cached !== undefined) return cached;

  const existing = inflight.get(normalized);
  if (existing) return existing;

  const promise = (async (): Promise<RouteInfo | null> => {
    try {
      const response = await fetch(
        `/api/routes?callsign=${encodeURIComponent(normalized)}`,
        {
          headers: { Accept: "application/json" },
          signal,
        },
      );

      if (response.status === 400 || response.status === 404) {
        cacheSet(normalized, null);
        return null;
      }

      if (!response.ok) return null;

      const route = parseRouteInfo(await response.json());
      if (route) cacheSet(normalized, route);
      return route;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      return null;
    } finally {
      inflight.delete(normalized);
    }
  })();

  inflight.set(normalized, promise);
  return promise;
}

export function clearRouteCache(): void {
  cache.clear();
}

export function formatAirportCode(airport: RouteAirport | null): string {
  if (!airport) return "";
  return airport.iata || airport.icao || "";
}

export function formatAirportFull(airport: RouteAirport | null): string {
  if (!airport) return "";
  const code = airport.iata || airport.icao;
  if (!code) return airport.name || "";
  if (airport.name) return `${airport.name} (${code})`;
  if (airport.municipality) return `${airport.municipality} (${code})`;
  return code;
}

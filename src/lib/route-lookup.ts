import type { RoutePositionContext } from "./route-validation";

export type RouteAirport = {
  iata: string;
  icao: string;
  name: string;
  municipality: string;
  countryIso: string;
  latitude: number;
  longitude: number;
};

export type RouteSource = "adsbdb" | "hexdb" | "opensky";

export type RouteInfo = {
  callsign: string;
  icao24: string;
  origin: RouteAirport | null;
  destination: RouteAirport | null;
  source: RouteSource;
  sources: RouteSource[];
  validation: "valid";
  validatedAt: number;
  fetchedAt: number;
};

export type RouteRequest = RoutePositionContext;

const CACHE_HIT_TTL_MS = 5 * 60_000;
const CACHE_MISS_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 300;
const SIX_HOURS_MS = 6 * 60 * 60_000;
const CALLSIGN_RE = /^[A-Z0-9]{1,8}$/;
const ICAO24_RE = /^[0-9a-f]{6}$/;

type CacheEntry = {
  route: RouteInfo | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RouteInfo | null>>();

export function normalizeRouteRequest(
  request: RouteRequest,
): RouteRequest | null {
  const callsign = request.callsign.trim().toUpperCase();
  const icao24 = request.icao24.trim().toLowerCase();
  if (!CALLSIGN_RE.test(callsign) || !ICAO24_RE.test(icao24)) return null;
  if (
    !Number.isFinite(request.latitude) ||
    request.latitude < -90 ||
    request.latitude > 90 ||
    !Number.isFinite(request.longitude) ||
    request.longitude < -180 ||
    request.longitude > 180 ||
    !Number.isFinite(request.observationTime) ||
    request.observationTime <= 0 ||
    (request.altitudeMeters !== null &&
      (!Number.isFinite(request.altitudeMeters) ||
        request.altitudeMeters < -1_000 ||
        request.altitudeMeters > 30_000))
  ) {
    return null;
  }
  return { ...request, callsign, icao24 };
}

export function routeCacheKey(request: RouteRequest): string {
  const bucket = Math.floor(request.observationTime / SIX_HOURS_MS);
  return `${request.icao24}:${request.callsign}:${bucket}`;
}

function cacheGet(key: string): RouteInfo | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.route;
}

function cacheSet(key: string, route: RouteInfo | null): void {
  cache.set(key, {
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
    airport.latitude >= -90 &&
    airport.latitude <= 90 &&
    typeof airport.longitude === "number" &&
    Number.isFinite(airport.longitude) &&
    airport.longitude >= -180 &&
    airport.longitude <= 180
  );
}

function parseRouteInfo(value: unknown, request: RouteRequest): RouteInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const route = value as Record<string, unknown>;
  if (route.callsign !== request.callsign || route.icao24 !== request.icao24) {
    return null;
  }
  if (
    route.source !== "adsbdb" &&
    route.source !== "hexdb" &&
    route.source !== "opensky"
  ) {
    return null;
  }
  if (
    !Array.isArray(route.sources) ||
    route.sources.length === 0 ||
    !route.sources.every(
      (source) =>
        source === "adsbdb" || source === "hexdb" || source === "opensky",
    ) ||
    route.validation !== "valid" ||
    typeof route.validatedAt !== "number" ||
    !Number.isFinite(route.validatedAt) ||
    typeof route.fetchedAt !== "number" ||
    !Number.isFinite(route.fetchedAt)
  ) {
    return null;
  }

  const origin = route.origin === null ? null : route.origin;
  const destination = route.destination === null ? null : route.destination;
  if (!isRouteAirport(origin) || !isRouteAirport(destination)) return null;

  return {
    callsign: request.callsign,
    icao24: request.icao24,
    origin,
    destination,
    source: route.source,
    sources: [...new Set(route.sources)] as RouteSource[],
    validation: "valid",
    validatedAt: route.validatedAt,
    fetchedAt: route.fetchedAt,
  };
}

export async function lookupRoute(
  input: RouteRequest,
  signal?: AbortSignal,
): Promise<RouteInfo | null> {
  const request = normalizeRouteRequest(input);
  if (!request) return null;
  const key = routeCacheKey(request);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const existing = inflight.get(key);
  if (existing) return existing;

  const query = new URLSearchParams({
    callsign: request.callsign,
    icao24: request.icao24,
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    altitudeMeters:
      request.altitudeMeters === null ? "" : String(request.altitudeMeters),
    onGround: request.onGround ? "1" : "0",
    observationTime: String(request.observationTime),
  });

  const promise = (async (): Promise<RouteInfo | null> => {
    try {
      const response = await fetch(`/api/routes?${query}`, {
        headers: { Accept: "application/json" },
        signal,
      });
      if (response.status === 404) {
        cacheSet(key, null);
        return null;
      }
      if (!response.ok) return null;
      const route = parseRouteInfo(await response.json(), request);
      if (route) cacheSet(key, route);
      return route;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return null;
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
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

import { createTtlCache } from "./ttl-cache";

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

/** A route one provider reports for a callsign, before any position check. */
export type ReportedRoute = {
  callsign: string;
  origin: RouteAirport;
  destination: RouteAirport;
  source: RouteSource;
  fetchedAt: number;
};

/**
 * Body of a successful /api/routes response: the first reported route's
 * fields at the top level, so older clients keep working, plus every
 * provider's route in priority order.
 */
export type RouteLookupResponse = ReportedRoute & { routes: ReportedRoute[] };

export const ROUTE_HIT_TTL_MS = 15 * 60_000;
export const ROUTE_MISS_TTL_MS = 2 * 60_000;
const CALLSIGN_PATTERN = /^[A-Z0-9]{1,8}$/;
const ROUTE_SOURCES: readonly RouteSource[] = ["adsbdb", "hexdb", "opensky"];

const cache = createTtlCache<ReportedRoute[]>(300);
const inflight = new Map<string, Promise<ReportedRoute[]>>();

export function normalizeRouteCallsign(
  callsign: string | null | undefined,
): string | null {
  const normalized = callsign?.trim().toUpperCase();
  return normalized && CALLSIGN_PATTERN.test(normalized) ? normalized : null;
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
    Math.abs(airport.latitude) <= 90 &&
    typeof airport.longitude === "number" &&
    Math.abs(airport.longitude) <= 180
  );
}

function isReportedRoute(value: unknown, callsign: string): value is ReportedRoute {
  if (typeof value !== "object" || value === null) return false;
  const route = value as Record<string, unknown>;
  return (
    route.callsign === callsign &&
    ROUTE_SOURCES.includes(route.source as RouteSource) &&
    typeof route.fetchedAt === "number" &&
    isRouteAirport(route.origin) &&
    isRouteAirport(route.destination)
  );
}

/** Fetches every provider's reported route for a callsign. */
export async function lookupReportedRoutes(
  rawCallsign: string,
  signal?: AbortSignal,
): Promise<ReportedRoute[]> {
  const callsign = normalizeRouteCallsign(rawCallsign);
  if (!callsign) return [];
  const cached = cache.get(callsign);
  if (cached) return cached;
  const existing = inflight.get(callsign);
  if (existing) return existing;

  const request = (async () => {
    try {
      const response = await fetch(
        `/api/routes?callsign=${encodeURIComponent(callsign)}`,
        { headers: { Accept: "application/json" }, signal },
      );
      if (response.status === 404) {
        cache.set(callsign, [], ROUTE_MISS_TTL_MS);
        return [];
      }
      if (!response.ok) return [];
      const body = (await response.json()) as Partial<RouteLookupResponse>;
      const routes = Array.isArray(body.routes)
        ? body.routes.filter((route) => isReportedRoute(route, callsign))
        : [];
      cache.set(callsign, routes, routes.length ? ROUTE_HIT_TTL_MS : ROUTE_MISS_TTL_MS);
      return routes;
    } catch {
      return [];
    } finally {
      inflight.delete(callsign);
    }
  })();

  inflight.set(callsign, request);
  return request;
}

export function clearRouteCache(): void {
  cache.clear();
}

export function formatAirportCode(airport: RouteAirport | null): string {
  if (!airport) return "";
  return airport.iata || airport.icao || "";
}

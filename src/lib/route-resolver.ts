import {
  normalizeRouteCallsign,
  ROUTE_HIT_TTL_MS,
  ROUTE_MISS_TTL_MS,
  type ReportedRoute,
  type RouteAirport,
  type RouteSource,
} from "./route-lookup";
import { createTtlCache } from "./ttl-cache";
import {
  clearStandingDataCache,
  findRouteAirport,
  lookupStandingDataRoute,
} from "./vrs-standing-data";

const ADSBDB_BASE = "https://api.adsbdb.com/v0";
const HEXDB_BASE = "https://hexdb.io/api/v1";
const OPEN_SKY_ROUTES_BASE = "https://opensky-network.org/api";

const PROVIDER_TIMEOUT_MS = 6_000;

// Standing data is read from whole cached files, not asked per callsign.
const PROVIDER_RATE_LIMIT_MS: Record<Exclude<RouteSource, "vrs">, number> = {
  adsbdb: 1_100,
  hexdb: 600,
  opensky: 1_100,
};

export type RouteResolution = {
  /**
   * Every leg each provider reports, in priority order: VRS standing data,
   * adsbdb, hexdb, OpenSky. A leg two providers both report is listed once.
   */
  routes: ReportedRoute[];
  temporarilyUnavailable: boolean;
};

const cache = createTtlCache<ReportedRoute[]>(500);
const inflight = new Map<string, Promise<RouteResolution>>();

type RateLimitedSource = keyof typeof PROVIDER_RATE_LIMIT_MS;

const lastRequestTime: Record<RateLimitedSource, number> = {
  adsbdb: 0,
  hexdb: 0,
  opensky: 0,
};

const providerQueues: Record<RateLimitedSource, Promise<void>> = {
  adsbdb: Promise.resolve(),
  hexdb: Promise.resolve(),
  opensky: Promise.resolve(),
};

async function enforceProviderRateLimit(source: RateLimitedSource) {
  const previous = providerQueues[source];

  const next = previous.then(async () => {
    const now = Date.now();
    const wait = Math.max(
      0,
      PROVIDER_RATE_LIMIT_MS[source] - (now - lastRequestTime[source]),
    );
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestTime[source] = Date.now();
  });

  providerQueues[source] = next.catch(() => {});
  return next;
}

async function fetchProviderJson(
  url: string,
  source: RateLimitedSource,
): Promise<{
  data: unknown | null;
  status: number;
  ok: boolean;
  cacheableMiss: boolean;
}> {
  await enforceProviderRateLimit(source);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });

    if (response.status === 404 || response.status === 400) {
      return {
        data: null,
        status: response.status,
        ok: false,
        cacheableMiss: true,
      };
    }

    if (!response.ok) {
      return {
        data: null,
        status: response.status,
        ok: false,
        cacheableMiss: false,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html") || contentType.includes("text/xml")) {
      return { data: null, status: 502, ok: false, cacheableMiss: false };
    }

    return {
      data: await response.json(),
      status: response.status,
      ok: true,
      cacheableMiss: false,
    };
  } catch {
    return { data: null, status: 502, ok: false, cacheableMiss: false };
  }
}

type ProviderRouteResult = {
  routes: ReportedRoute[];
  cacheableMiss: boolean;
};

const NO_ROUTE: ProviderRouteResult = { routes: [], cacheableMiss: true };

/** adsbdb names a few airports by IATA code alone. */
function airportCode(airport: RouteAirport): string {
  return airport.icao || airport.iata;
}

/**
 * One route per leg of a flight that calls at the given airports in turn.
 * A leg to or from an airport that could not be found is left out.
 */
function legsBetween(
  callsign: string,
  airports: (RouteAirport | null)[],
  source: RouteSource,
): ReportedRoute[] {
  const fetchedAt = Date.now();
  const legs: ReportedRoute[] = [];
  for (let i = 0; i + 1 < airports.length; i++) {
    const origin = airports[i];
    const destination = airports[i + 1];
    if (
      !origin ||
      !destination ||
      airportCode(origin) === airportCode(destination)
    ) {
      continue;
    }
    legs.push({ callsign, origin, destination, source, fetchedAt });
  }
  return legs;
}

/** Legs between airports named by ICAO code. */
async function legsBetweenCodes(
  callsign: string,
  codes: string[],
  source: RouteSource,
): Promise<ReportedRoute[]> {
  const airports = await Promise.all(
    codes.map((code) => findRouteAirport(code)),
  );
  return legsBetween(callsign, airports, source);
}

/** ICAO codes of a route's airports, or null unless there are two or more. */
function parseAirportCodes(parts: readonly unknown[]): string[] | null {
  const codes = parts.map((part) => String(part).trim().toUpperCase());
  return codes.length >= 2 && codes.every((code) => /^[A-Z0-9]{4}$/.test(code))
    ? codes
    : null;
}

// ── VRS standing data ───────────────────────────────────────────────────

async function fetchFromVrs(callsign: string): Promise<ProviderRouteResult> {
  const { airportCodes, cacheableMiss } =
    await lookupStandingDataRoute(callsign);
  if (!airportCodes) return { routes: [], cacheableMiss };
  return {
    routes: await legsBetweenCodes(callsign, airportCodes, "vrs"),
    cacheableMiss: true,
  };
}

// ── ADSBDB ──────────────────────────────────────────────────────────────

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
  if (
    (!iata && !icao) ||
    typeof raw.latitude !== "number" ||
    !Number.isFinite(raw.latitude) ||
    raw.latitude < -90 ||
    raw.latitude > 90 ||
    typeof raw.longitude !== "number" ||
    !Number.isFinite(raw.longitude) ||
    raw.longitude < -180 ||
    raw.longitude > 180
  ) {
    return null;
  }

  return {
    iata: iata ?? "",
    icao: icao ?? "",
    name: raw.name?.trim() ?? "",
    municipality: raw.municipality?.trim() ?? "",
    countryIso: raw.country_iso_name?.trim() ?? "",
    latitude: raw.latitude,
    longitude: raw.longitude,
  };
}

/** The app's own record of an airport adsbdb names, else adsbdb's. */
async function normalizeAdsbdbAirport(
  airport: RouteAirport | null,
): Promise<RouteAirport | null> {
  if (!airport?.icao) return airport;
  return (await findRouteAirport(airport.icao)) ?? airport;
}

async function fetchFromAdsbdb(callsign: string): Promise<ProviderRouteResult> {
  const result = await fetchProviderJson(
    `${ADSBDB_BASE}/callsign/${encodeURIComponent(callsign)}`,
    "adsbdb",
  );

  if (!result.ok || typeof result.data !== "object" || result.data === null) {
    return { routes: [], cacheableMiss: result.cacheableMiss };
  }

  const response = (result.data as Record<string, unknown>).response;
  if (typeof response !== "object" || response === null) {
    return NO_ROUTE;
  }

  const flightroute = (response as Record<string, unknown>).flightroute;
  if (typeof flightroute !== "object" || flightroute === null) {
    return NO_ROUTE;
  }

  // adsbdb gives only the first leg of a flight with stops.
  const route = flightroute as Record<string, unknown>;
  const airports = await Promise.all(
    [route.origin, route.destination].map((airport) =>
      normalizeAdsbdbAirport(
        parseAdsbdbAirport(airport as AdsbdbAirport | null),
      ),
    ),
  );
  return {
    routes: legsBetween(callsign, airports, "adsbdb"),
    cacheableMiss: true,
  };
}

// ── HexDB ───────────────────────────────────────────────────────────────

async function fetchFromHexdb(callsign: string): Promise<ProviderRouteResult> {
  const result = await fetchProviderJson(
    `${HEXDB_BASE}/route/icao/${encodeURIComponent(callsign)}`,
    "hexdb",
  );

  if (!result.ok || typeof result.data !== "object" || result.data === null) {
    return { routes: [], cacheableMiss: result.cacheableMiss };
  }

  // A flight with stops reads "KPHL-KORD-KOMA".
  const route = (result.data as Record<string, unknown>).route;
  if (typeof route !== "string") return NO_ROUTE;
  const codes = parseAirportCodes(route.split("-"));
  if (!codes) return NO_ROUTE;
  return {
    routes: await legsBetweenCodes(callsign, codes, "hexdb"),
    cacheableMiss: true,
  };
}

// ── OpenSky ─────────────────────────────────────────────────────────────

/**
 * OpenSky routes endpoint returns:
 *   {"callsign":"BAW123","route":["EGLL","KJFK"],"updateTime":1234567890}
 *
 * with every stop of a flight that makes them.
 */
async function fetchFromOpenSky(callsign: string): Promise<ProviderRouteResult> {
  const result = await fetchProviderJson(
    `${OPEN_SKY_ROUTES_BASE}/routes?callsign=${encodeURIComponent(callsign)}`,
    "opensky",
  );

  if (!result.ok || typeof result.data !== "object" || result.data === null) {
    return { routes: [], cacheableMiss: result.cacheableMiss };
  }

  const route = (result.data as Record<string, unknown>).route;
  const codes = Array.isArray(route) ? parseAirportCodes(route) : null;
  if (!codes) return NO_ROUTE;
  return {
    routes: await legsBetweenCodes(callsign, codes, "opensky"),
    cacheableMiss: true,
  };
}

// ── Resolver ────────────────────────────────────────────────────────────

export async function resolveReportedRoutes(
  rawCallsign: string | null | undefined,
): Promise<RouteResolution> {
  const callsign = normalizeRouteCallsign(rawCallsign);
  if (!callsign) return { routes: [], temporarilyUnavailable: false };

  const cached = cache.get(callsign);
  if (cached) return { routes: cached, temporarilyUnavailable: false };

  const existing = inflight.get(callsign);
  if (existing) return existing;

  const promise = (async (): Promise<RouteResolution> => {
    try {
      const results = await Promise.all([
        fetchFromVrs(callsign),
        fetchFromAdsbdb(callsign),
        fetchFromHexdb(callsign),
        fetchFromOpenSky(callsign),
      ]);
      const seen = new Set<string>();
      const routes = results
        .flatMap((result) => result.routes)
        .filter((route) => {
          const leg = [route.origin, route.destination]
            .map(airportCode)
            .join("-");
          if (seen.has(leg)) return false;
          seen.add(leg);
          return true;
        });

      if (routes.length > 0) {
        cache.set(callsign, routes, ROUTE_HIT_TTL_MS);
        return { routes, temporarilyUnavailable: false };
      }
      // A provider error leaves the miss uncached so the next request retries.
      if (results.every((result) => result.cacheableMiss)) {
        cache.set(callsign, [], ROUTE_MISS_TTL_MS);
        return { routes: [], temporarilyUnavailable: false };
      }
      return { routes: [], temporarilyUnavailable: true };
    } finally {
      inflight.delete(callsign);
    }
  })();

  inflight.set(callsign, promise);
  return promise;
}

export function clearRouteResolverCache(): void {
  cache.clear();
  clearStandingDataCache();
}

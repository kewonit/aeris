import {
  routeCacheKey,
  type RouteAirport,
  type RouteInfo,
  type RouteSource,
} from "./route-lookup";
import {
  validateReportedRoute,
  type RoutePositionContext,
} from "./route-validation";
import { findAirportByIcao } from "./airports";

const ADSBDB_BASE = "https://api.adsbdb.com/v0";
const HEXDB_BASE = "https://hexdb.io/api/v1";
const OPEN_SKY_ROUTES_BASE = "https://opensky-network.org/api";

const CACHE_HIT_TTL_MS = 5 * 60_000;
const CACHE_MISS_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

const PROVIDER_TIMEOUT_MS = 6_000;

const PROVIDER_RATE_LIMIT_MS: Record<RouteSource, number> = {
  adsbdb: 1_100,
  hexdb: 600,
  opensky: 1_100,
};

const CALLSIGN_RE = /^[A-Z0-9]{1,8}$/i;

export type RouteResolution = {
  route: RouteInfo | null;
  temporarilyUnavailable: boolean;
  validationConflict: boolean;
};

export function normalizeRouteCallsign(
  callsign: string | null | undefined,
): string | null {
  if (!callsign) return null;
  const normalized = callsign.trim().toUpperCase();
  return normalized && CALLSIGN_RE.test(normalized) ? normalized : null;
}

type CacheEntry = {
  route: RouteInfo | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RouteResolution>>();

const lastRequestTime: Record<RouteSource, number> = {
  adsbdb: 0,
  hexdb: 0,
  opensky: 0,
};

const providerQueues: Record<RouteSource, Promise<void>> = {
  adsbdb: Promise.resolve(),
  hexdb: Promise.resolve(),
  opensky: Promise.resolve(),
};

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

async function enforceProviderRateLimit(source: RouteSource) {
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
  source: RouteSource,
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
  route: ProviderRoute | null;
  cacheableMiss: boolean;
};

type ProviderRoute = Pick<
  RouteInfo,
  "callsign" | "origin" | "destination" | "source" | "fetchedAt"
>;

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

async function fetchFromAdsbdb(callsign: string): Promise<ProviderRouteResult> {
  const result = await fetchProviderJson(
    `${ADSBDB_BASE}/callsign/${encodeURIComponent(callsign)}`,
    "adsbdb",
  );

  if (!result.ok || typeof result.data !== "object" || result.data === null) {
    return { route: null, cacheableMiss: result.cacheableMiss };
  }

  const response = (result.data as Record<string, unknown>).response;
  if (typeof response !== "object" || response === null) {
    return { route: null, cacheableMiss: true };
  }

  const flightroute = (response as Record<string, unknown>).flightroute;
  if (typeof flightroute !== "object" || flightroute === null) {
    return { route: null, cacheableMiss: true };
  }

  const route = flightroute as Record<string, unknown>;
  const origin = parseAdsbdbAirport(route.origin as AdsbdbAirport | null);
  const destination = parseAdsbdbAirport(
    route.destination as AdsbdbAirport | null,
  );

  // Require both endpoints for a complete reported route.
  if (!origin || !destination) {
    return { route: null, cacheableMiss: true };
  }

  return {
    route: {
      callsign,
      origin,
      destination,
      source: "adsbdb",
      fetchedAt: Date.now(),
    },
    cacheableMiss: true,
  };
}

// ── HexDB ───────────────────────────────────────────────────────────────

function parseHexdbAirport(
  raw: unknown,
  fallbackIcao: string,
): RouteAirport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.status === "string" && obj.status === "404") return null;
  if (
    typeof obj.latitude !== "number" ||
    !Number.isFinite(obj.latitude) ||
    obj.latitude < -90 ||
    obj.latitude > 90 ||
    typeof obj.longitude !== "number" ||
    !Number.isFinite(obj.longitude) ||
    obj.longitude < -180 ||
    obj.longitude > 180
  ) {
    return null;
  }

  return {
    iata: typeof obj.iata === "string" ? obj.iata.trim() : "",
    icao: typeof obj.icao === "string" ? obj.icao.trim() : fallbackIcao,
    name: typeof obj.airport === "string" ? obj.airport.trim() : "",
    municipality:
      typeof obj.region_name === "string" ? obj.region_name.trim() : "",
    countryIso:
      typeof obj.country_code === "string" ? obj.country_code.trim() : "",
    latitude: obj.latitude,
    longitude: obj.longitude,
  };
}

async function fetchHexdbAirport(icao: string): Promise<RouteAirport | null> {
  const result = await fetchProviderJson(
    `${HEXDB_BASE}/airport/icao/${encodeURIComponent(icao)}`,
    "hexdb",
  );

  if (!result.ok) return null;
  return parseHexdbAirport(result.data, icao);
}

async function fetchFromHexdb(callsign: string): Promise<ProviderRouteResult> {
  const result = await fetchProviderJson(
    `${HEXDB_BASE}/route/icao/${encodeURIComponent(callsign)}`,
    "hexdb",
  );

  if (!result.ok || typeof result.data !== "object" || result.data === null) {
    return { route: null, cacheableMiss: result.cacheableMiss };
  }

  const route = (result.data as Record<string, unknown>).route;
  if (typeof route !== "string") {
    return { route: null, cacheableMiss: true };
  }

  const parts = route
    .split("-")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  if (parts.length < 2) return { route: null, cacheableMiss: true };

  const originIcao = parts[0];
  const destinationIcao = parts[parts.length - 1];
  if (
    !/^[A-Z0-9]{4}$/.test(originIcao) ||
    !/^[A-Z0-9]{4}$/.test(destinationIcao)
  ) {
    return { route: null, cacheableMiss: true };
  }

  const [originDetail, destinationDetail] = await Promise.all([
    fetchHexdbAirport(originIcao),
    fetchHexdbAirport(destinationIcao),
  ]);

  // Require both airports with real data
  if (!originDetail || !destinationDetail) {
    return { route: null, cacheableMiss: true };
  }

  return {
    route: {
      callsign,
      origin: originDetail,
      destination: destinationDetail,
      source: "hexdb",
      fetchedAt: Date.now(),
    },
    cacheableMiss: true,
  };
}

// ── OpenSky ─────────────────────────────────────────────────────────────

/**
 * OpenSky routes endpoint returns:
 *   {"callsign":"BAW123","route":["EGLL","KJFK"],"updateTime":1234567890}
 *
 * We resolve ICAO codes against our local airport database.
 */
async function fetchFromOpenSky(callsign: string): Promise<ProviderRouteResult> {
  const result = await fetchProviderJson(
    `${OPEN_SKY_ROUTES_BASE}/routes?callsign=${encodeURIComponent(callsign)}`,
    "opensky",
  );

  if (!result.ok || typeof result.data !== "object" || result.data === null) {
    return { route: null, cacheableMiss: result.cacheableMiss };
  }

  const data = result.data as Record<string, unknown>;
  const routeArr = data.route;
  if (!Array.isArray(routeArr) || routeArr.length < 2) {
    return { route: null, cacheableMiss: true };
  }

  const originIcao = String(routeArr[0]).trim().toUpperCase();
  const destinationIcao = String(routeArr[routeArr.length - 1])
    .trim()
    .toUpperCase();

  if (
    !/^[A-Z0-9]{4}$/.test(originIcao) ||
    !/^[A-Z0-9]{4}$/.test(destinationIcao)
  ) {
    return { route: null, cacheableMiss: true };
  }

  const originAirport = findAirportByIcao(originIcao);
  const destAirport = findAirportByIcao(destinationIcao);

  // OpenSky returns ICAO codes only. We need both airports in our database
  // to produce a complete reported route.
  if (!originAirport || !destAirport) {
    return { route: null, cacheableMiss: true };
  }

  const toRouteAirport = (a: typeof originAirport): RouteAirport => ({
    iata: a.iata ?? "",
    icao: a.icao,
    name: a.name,
    municipality: a.city,
    countryIso: a.country,
    latitude: a.lat,
    longitude: a.lng,
  });

  return {
    route: {
      callsign,
      origin: toRouteAirport(originAirport),
      destination: toRouteAirport(destAirport),
      source: "opensky",
      fetchedAt: Date.now(),
    },
    cacheableMiss: true,
  };
}

// ── Resolver ────────────────────────────────────────────────────────────

function routeEndpoints(route: ProviderRoute): string {
  const origin = route.origin?.icao || route.origin?.iata || "";
  const destination =
    route.destination?.icao || route.destination?.iata || "";
  return `${origin}:${destination}`;
}

function selectValidRoute(
  routes: ProviderRoute[],
  context: RoutePositionContext,
): RouteInfo | null {
  for (const route of routes) {
    if (!route.origin || !route.destination) continue;
    const validation = validateReportedRoute(
      route.origin,
      route.destination,
      context,
    );
    if (!validation.valid) continue;
    const endpoints = routeEndpoints(route);
    const sources = routes
      .filter((candidate) => routeEndpoints(candidate) === endpoints)
      .map((candidate) => candidate.source);
    return {
      ...route,
      icao24: context.icao24,
      sources: [...new Set(sources)],
      validation: "valid",
      validatedAt: Date.now(),
    };
  }
  return null;
}

export async function resolveRouteFromOpenDatabases(
  context: RoutePositionContext,
): Promise<RouteInfo | null> {
  const resolution = await resolveRouteFromOpenDatabasesDetailed(context);
  return resolution.route;
}

export async function resolveRouteFromOpenDatabasesDetailed(
  context: RoutePositionContext,
): Promise<RouteResolution> {
  const normalized = normalizeRouteCallsign(context.callsign);
  const icao24 = context.icao24.trim().toLowerCase();
  if (!normalized || !/^[0-9a-f]{6}$/.test(icao24)) {
    return {
      route: null,
      temporarilyUnavailable: false,
      validationConflict: false,
    };
  }
  const normalizedContext = { ...context, callsign: normalized, icao24 };
  const key = routeCacheKey(normalizedContext);

  const cached = cacheGet(key);
  if (cached !== undefined) {
    return {
      route: cached,
      temporarilyUnavailable: false,
      validationConflict: false,
    };
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const [adsbdbResult, hexdbResult, openskyResult] = await Promise.all([
        fetchFromAdsbdb(normalized),
        fetchFromHexdb(normalized),
        fetchFromOpenSky(normalized),
      ]);

      const routes = [
        adsbdbResult.route,
        hexdbResult.route,
        openskyResult.route,
      ].filter((route): route is ProviderRoute => route !== null);
      if (routes.length > 0) {
        const route = selectValidRoute(routes, normalizedContext);
        cacheSet(key, route);
        return {
          route,
          temporarilyUnavailable: false,
          validationConflict: route === null,
        };
      }

      const allCacheable =
        adsbdbResult.cacheableMiss &&
        hexdbResult.cacheableMiss &&
        openskyResult.cacheableMiss;

      if (allCacheable) {
        cacheSet(key, null);
        return {
          route: null,
          temporarilyUnavailable: false,
          validationConflict: false,
        };
      }

      return {
        route: null,
        temporarilyUnavailable: true,
        validationConflict: false,
      };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export function clearRouteResolverCache(): void {
  cache.clear();
}

import type { RouteAirport, RouteInfo } from "./route-lookup";

const ADSBDB_BASE = "https://api.adsbdb.com/v0";
const HEXDB_BASE = "https://hexdb.io/api/v1";

const CACHE_HIT_TTL_MS = 15 * 60_000;
const CACHE_MISS_TTL_MS = 2 * 60_000;
const CACHE_MAX_ENTRIES = 300;

const PROVIDER_TIMEOUT_MS = 5_000;
const PROVIDER_RATE_LIMIT_MS: Record<RouteInfo["source"], number> = {
  adsbdb: 1_100,
  hexdb: 600,
};

const CALLSIGN_RE = /^[A-Z0-9]{1,8}$/i;

export type RouteResolution = {
  route: RouteInfo | null;
  temporarilyUnavailable: boolean;
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

const lastRequestTime: Record<RouteInfo["source"], number> = {
  adsbdb: 0,
  hexdb: 0,
};

const providerQueues: Record<RouteInfo["source"], Promise<void>> = {
  adsbdb: Promise.resolve(),
  hexdb: Promise.resolve(),
};

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

async function enforceProviderRateLimit(source: RouteInfo["source"]) {
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
  source: RouteInfo["source"],
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
  route: RouteInfo | null;
  cacheableMiss: boolean;
};

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

  if (!origin && !destination) {
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

function parseHexdbAirport(
  raw: unknown,
  fallbackIcao: string,
): RouteAirport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.status === "string" && obj.status === "404") return null;

  return {
    iata: typeof obj.iata === "string" ? obj.iata.trim() : "",
    icao: typeof obj.icao === "string" ? obj.icao.trim() : fallbackIcao,
    name: typeof obj.airport === "string" ? obj.airport.trim() : "",
    municipality:
      typeof obj.region_name === "string" ? obj.region_name.trim() : "",
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

  return {
    route: {
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
      destination: destinationDetail ?? {
        iata: "",
        icao: destinationIcao,
        name: "",
        municipality: "",
        countryIso: "",
        latitude: 0,
        longitude: 0,
      },
      source: "hexdb",
      fetchedAt: Date.now(),
    },
    cacheableMiss: true,
  };
}

export async function resolveRouteFromOpenDatabases(
  callsign: string | null | undefined,
): Promise<RouteInfo | null> {
  const resolution = await resolveRouteFromOpenDatabasesDetailed(callsign);
  return resolution.route;
}

export async function resolveRouteFromOpenDatabasesDetailed(
  callsign: string | null | undefined,
): Promise<RouteResolution> {
  const normalized = normalizeRouteCallsign(callsign);
  if (!normalized) return { route: null, temporarilyUnavailable: false };

  const cached = cacheGet(normalized);
  if (cached !== undefined) {
    return { route: cached, temporarilyUnavailable: false };
  }

  const existing = inflight.get(normalized);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const adsbdbResult = await fetchFromAdsbdb(normalized);
      if (adsbdbResult.route) {
        cacheSet(normalized, adsbdbResult.route);
        return { route: adsbdbResult.route, temporarilyUnavailable: false };
      }

      const hexdbResult = await fetchFromHexdb(normalized);
      if (hexdbResult.route) {
        cacheSet(normalized, hexdbResult.route);
        return { route: hexdbResult.route, temporarilyUnavailable: false };
      }

      if (adsbdbResult.cacheableMiss && hexdbResult.cacheableMiss) {
        cacheSet(normalized, null);
        return { route: null, temporarilyUnavailable: false };
      }

      return { route: null, temporarilyUnavailable: true };
    } finally {
      inflight.delete(normalized);
    }
  })();

  inflight.set(normalized, promise);
  return promise;
}

export function clearRouteResolverCache(): void {
  cache.clear();
}

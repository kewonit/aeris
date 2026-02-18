/** @see https://openskynetwork.github.io/opensky-api/rest.html */

const OPENSKY_API = "https://opensky-network.org/api";
const FETCH_TIMEOUT_MS = 15_000;
const ICAO24_REGEX = /^[0-9a-f]{6}$/i;
const CALLSIGN_CACHE_TTL_MS = 30_000;

export type FlightState = {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  spiFlag: boolean;
  positionSource: number;
  category: number | null;
};

type OpenSkyResponse = {
  time: number;
  states: (string | number | boolean | null)[][] | null;
};

type ParseStateOptions = {
  includeGround?: boolean;
  requireBaroAltitude?: boolean;
};

type RateLimitInfo = {
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function parseIntegerHeader(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRateLimitInfo(response: Response): RateLimitInfo {
  return {
    creditsRemaining: parseIntegerHeader(
      response.headers.get("x-rate-limit-remaining"),
    ),
    retryAfterSeconds: parseIntegerHeader(
      response.headers.get("x-rate-limit-retry-after-seconds"),
    ),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeBounds(
  lower: number,
  upper: number,
  min: number,
  max: number,
): [number, number] {
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new Error("Invalid bounding box coordinates");
  }
  const lo = clamp(lower, min, max);
  const hi = clamp(upper, min, max);
  return lo <= hi ? [lo, hi] : [hi, lo];
}

function parseStateRow(rawState: (string | number | boolean | null)[]): FlightState | null {
  if (rawState.length < 17) return null;

  const icao24 = typeof rawState[0] === "string" ? rawState[0].toLowerCase() : "";
  if (!ICAO24_REGEX.test(icao24)) return null;

  const longitude = isFiniteNumber(rawState[5]) ? rawState[5] : null;
  const latitude = isFiniteNumber(rawState[6]) ? rawState[6] : null;
  const baroAltitude = isFiniteNumber(rawState[7]) ? rawState[7] : null;

  return {
    icao24,
    callsign: typeof rawState[1] === "string" ? rawState[1].trim() || null : null,
    originCountry:
      typeof rawState[2] === "string" ? rawState[2] : "Unknown",
    longitude,
    latitude,
    baroAltitude,
    onGround: rawState[8] === true,
    velocity: isFiniteNumber(rawState[9]) ? rawState[9] : null,
    trueTrack: isFiniteNumber(rawState[10]) ? rawState[10] : null,
    verticalRate: isFiniteNumber(rawState[11]) ? rawState[11] : null,
    geoAltitude: isFiniteNumber(rawState[13]) ? rawState[13] : null,
    squawk: typeof rawState[14] === "string" ? rawState[14] : null,
    spiFlag: rawState[15] === true,
    positionSource: isFiniteNumber(rawState[16]) ? rawState[16] : 0,
    category: isFiniteNumber(rawState[17]) ? rawState[17] : null,
  };
}

function parseStates(raw: OpenSkyResponse, options?: ParseStateOptions): FlightState[] {
  if (!raw || !Array.isArray(raw.states)) return [];

  const includeGround = options?.includeGround ?? false;
  const requireBaroAltitude = options?.requireBaroAltitude ?? true;

  return raw.states
    .map(parseStateRow)
    .filter((state): state is FlightState => state !== null)
    .filter(
      (f) =>
        f.longitude !== null &&
        f.latitude !== null &&
        (includeGround || !f.onGround) &&
        (!requireBaroAltitude || f.baroAltitude !== null),
    );
}

function normalizeCallsign(value: string | null): string {
  if (!value) return "";
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export type FetchResult = {
  flights: FlightState[];
  rateLimited: boolean;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
};

export async function fetchFlightsByBbox(
  lamin: number,
  lamax: number,
  lomin: number,
  lomax: number,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const [la0, la1] = normalizeBounds(lamin, lamax, -90, 90);
  const [lo0, lo1] = normalizeBounds(lomin, lomax, -180, 180);

  const url = `${OPENSKY_API}/states/all?lamin=${la0}&lamax=${la1}&lomin=${lo0}&lomax=${lo1}&extended=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const rateLimitInfo = parseRateLimitInfo(res);

    if (res.status === 429) {
      return {
        flights: [],
        rateLimited: true,
        creditsRemaining: rateLimitInfo.creditsRemaining,
        retryAfterSeconds: rateLimitInfo.retryAfterSeconds,
      };
    }

    if (!res.ok) {
      return {
        flights: [],
        rateLimited: false,
        creditsRemaining: rateLimitInfo.creditsRemaining,
        retryAfterSeconds: null,
      };
    }

    const payload = (await res.json()) as unknown;
    const data =
      typeof payload === "object" && payload !== null
        ? (payload as OpenSkyResponse)
        : { time: 0, states: null };

    return {
      flights: parseStates(data),
      rateLimited: false,
      creditsRemaining: rateLimitInfo.creditsRemaining,
      retryAfterSeconds: null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (signal?.aborted) throw err;
      throw new Error("OpenSky request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

export function bboxFromCenter(
  lng: number,
  lat: number,
  radiusDeg: number,
): [lamin: number, lamax: number, lomin: number, lomax: number] {
  return [lat - radiusDeg, lat + radiusDeg, lng - radiusDeg, lng + radiusDeg];
}

/**
 * Fetch a single aircraft's state by its ICAO24 address (global lookup).
 * Costs 4 API credits (no bbox = full globe) but returns at most one result.
 * Returns the flight if found, or null.
 */
export async function fetchFlightByIcao24(
  icao24: string,
  signal?: AbortSignal,
): Promise<{ flight: FlightState | null; creditsRemaining: number | null }> {
  const normalizedIcao24 = icao24.trim().toLowerCase();
  if (!ICAO24_REGEX.test(normalizedIcao24)) {
    return { flight: null, creditsRemaining: null };
  }

  const url = `${OPENSKY_API}/states/all?icao24=${encodeURIComponent(normalizedIcao24)}&extended=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const rateLimitInfo = parseRateLimitInfo(res);

    if (res.status === 429 || !res.ok) {
      return { flight: null, creditsRemaining: rateLimitInfo.creditsRemaining };
    }

    const payload = (await res.json()) as unknown;
    const data =
      typeof payload === "object" && payload !== null
        ? (payload as OpenSkyResponse)
        : { time: 0, states: null };
    const flights = parseStates(data, {
      includeGround: true,
      requireBaroAltitude: false,
    });
    return {
      flight:
        flights.find((f) => f.icao24 === normalizedIcao24) ?? null,
      creditsRemaining: rateLimitInfo.creditsRemaining,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (signal?.aborted) throw err;
    }
    return { flight: null, creditsRemaining: null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

type CallsignLookupResult = {
  flight: FlightState | null;
  creditsRemaining: number | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
};

const callsignLookupCache = new Map<
  string,
  { timestamp: number; result: CallsignLookupResult }
>();

export async function fetchFlightByCallsign(
  callsign: string,
  signal?: AbortSignal,
): Promise<CallsignLookupResult> {
  const normalizedQuery = normalizeCallsign(callsign);
  if (!normalizedQuery) {
    return {
      flight: null,
      creditsRemaining: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
  }

  const cached = callsignLookupCache.get(normalizedQuery);
  if (cached && Date.now() - cached.timestamp <= CALLSIGN_CACHE_TTL_MS) {
    return cached.result;
  }

  const url = `${OPENSKY_API}/states/all?extended=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const rateLimitInfo = parseRateLimitInfo(res);

    if (res.status === 429) {
      return {
        flight: null,
        creditsRemaining: rateLimitInfo.creditsRemaining,
        rateLimited: true,
        retryAfterSeconds: rateLimitInfo.retryAfterSeconds,
      };
    }

    if (!res.ok) {
      return {
        flight: null,
        creditsRemaining: rateLimitInfo.creditsRemaining,
        rateLimited: false,
        retryAfterSeconds: null,
      };
    }

    const payload = (await res.json()) as unknown;
    const data =
      typeof payload === "object" && payload !== null
        ? (payload as OpenSkyResponse)
        : { time: 0, states: null };

    const flights = parseStates(data, {
      includeGround: true,
      requireBaroAltitude: false,
    });

    const exact = flights.find(
      (f) => normalizeCallsign(f.callsign) === normalizedQuery,
    );
    const startsWith =
      exact ??
      flights.find((f) => normalizeCallsign(f.callsign).startsWith(normalizedQuery));
    const contains =
      startsWith ??
      flights.find((f) => normalizeCallsign(f.callsign).includes(normalizedQuery));

    const result: CallsignLookupResult = {
      flight: contains ?? null,
      creditsRemaining: rateLimitInfo.creditsRemaining,
      rateLimited: false,
      retryAfterSeconds: null,
    };

    callsignLookupCache.set(normalizedQuery, {
      timestamp: Date.now(),
      result,
    });

    return result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (signal?.aborted) throw err;
    }
    return {
      flight: null,
      creditsRemaining: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

const SEGMENT_DELAY_MS = 200;

/**
 * Fetch flights across multiple bounding-box segments (for route corridors).
 * Segments are fetched sequentially with a small delay to avoid burst rate limits.
 * Results are merged and deduplicated by icao24.
 *
 * If a 429 is received mid-sequence, partial results collected so far are returned
 * with `rateLimited: true`.
 */
export async function fetchFlightsByRoute(
  segments: { lamin: number; lamax: number; lomin: number; lomax: number }[],
  signal?: AbortSignal,
): Promise<FetchResult> {
  if (segments.length === 0) {
    return {
      flights: [],
      rateLimited: false,
      creditsRemaining: null,
      retryAfterSeconds: null,
    };
  }

  const seen = new Map<string, FlightState>();
  let rateLimited = false;
  let lowestCredits: number | null = null;
  let retryAfterSeconds: number | null = null;

  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const seg = segments[i];
    const result = await fetchFlightsByBbox(
      seg.lamin,
      seg.lamax,
      seg.lomin,
      seg.lomax,
      signal,
    );

    for (const f of result.flights) {
      if (!seen.has(f.icao24)) {
        seen.set(f.icao24, f);
      }
    }

    if (result.creditsRemaining !== null) {
      lowestCredits =
        lowestCredits === null
          ? result.creditsRemaining
          : Math.min(lowestCredits, result.creditsRemaining);
    }

    if (result.rateLimited) {
      rateLimited = true;
      retryAfterSeconds = result.retryAfterSeconds;
      break;
    }

    if (i < segments.length - 1) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SEGMENT_DELAY_MS);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  return {
    flights: Array.from(seen.values()),
    rateLimited,
    creditsRemaining: lowestCredits,
    retryAfterSeconds,
  };
}

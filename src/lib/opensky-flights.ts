import type {
  CallsignLookupResult,
  FetchResult,
  FlightState,
  OpenSkyResponse,
} from "./opensky-types";
import {
  CALLSIGN_CACHE_MAX_ENTRIES,
  CALLSIGN_CACHE_TTL_MS,
  FETCH_TIMEOUT_MS,
  ICAO24_REGEX,
  MAX_1_CREDIT_RADIUS_DEG,
  OPENSKY_API,
  SEGMENT_DELAY_MS,
} from "./opensky-types";
import {
  normalizeCallsign,
  normalizeBounds,
  parseRateLimitInfo,
  parseStates,
} from "./opensky-parsing";

// ── Bounding Box Flights ───────────────────────────────────────────────

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

    // Reject non-JSON responses (CloudFlare challenge pages)
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html") || ct.includes("text/xml")) {
      throw new Error("OpenSky returned non-JSON response");
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

// ── Bbox Helper ────────────────────────────────────────────────────────

export function bboxFromCenter(
  lng: number,
  lat: number,
  radiusDeg: number,
): [lamin: number, lamax: number, lomin: number, lomax: number] {
  // If callers pass a bogus radius, fall back to a safe 1-credit value.
  const safeRadiusRaw =
    Number.isFinite(radiusDeg) && radiusDeg > 0
      ? radiusDeg
      : MAX_1_CREDIT_RADIUS_DEG;
  const safeRadius = Math.min(safeRadiusRaw, MAX_1_CREDIT_RADIUS_DEG);

  // Compensate longitude extent for converging meridians at higher latitudes.
  // At the equator cos(0)=1 so lngRadius equals safeRadius (no change).
  // At 60°N cos(60°)=0.5 so lngRadius doubles to cover the same ground distance.
  // Clamp near poles to avoid division by near-zero.
  const cosLat = Math.cos((Math.abs(lat) * Math.PI) / 180);
  const lngRadius = Math.min(180, safeRadius / Math.max(cosLat, 0.01));

  return [lat - safeRadius, lat + safeRadius, lng - lngRadius, lng + lngRadius];
}

// ── Single Aircraft by ICAO24 ──────────────────────────────────────────

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

    // Reject non-JSON responses (CloudFlare challenge pages)
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html") || ct.includes("text/xml")) {
      throw new Error("OpenSky returned non-JSON response");
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
      flight: flights.find((f) => f.icao24 === normalizedIcao24) ?? null,
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

// ── Callsign Search ────────────────────────────────────────────────────

const callsignLookupCache = new Map<
  string,
  { timestamp: number; result: CallsignLookupResult }
>();

// In-flight promise dedup: prevents concurrent 4-credit global fetches
// for the same normalized callsign query.
const callsignInFlight = new Map<string, Promise<CallsignLookupResult>>();

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

  // If there's already an in-flight request for this query, piggyback on it
  const existing = callsignInFlight.get(normalizedQuery);
  if (existing) return existing;

  const promise = fetchFlightByCallsignImpl(normalizedQuery, signal);
  callsignInFlight.set(normalizedQuery, promise);

  try {
    return await promise;
  } finally {
    callsignInFlight.delete(normalizedQuery);
  }
}

async function fetchFlightByCallsignImpl(
  normalizedQuery: string,
  signal?: AbortSignal,
): Promise<CallsignLookupResult> {
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
      flights.find((f) =>
        normalizeCallsign(f.callsign).startsWith(normalizedQuery),
      );
    const contains =
      startsWith ??
      flights.find((f) =>
        normalizeCallsign(f.callsign).includes(normalizedQuery),
      );

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
    if (callsignLookupCache.size > CALLSIGN_CACHE_MAX_ENTRIES) {
      const oldestKey = callsignLookupCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey) callsignLookupCache.delete(oldestKey);
    }

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

// ── Route Corridor Fetch ───────────────────────────────────────────────

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

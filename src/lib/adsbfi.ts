/**
 * ADS-B.fi API v3 Adapter
 *
 * Drop-in replacement for opensky.ts. Exports the same public API so that
 * consumers (use-flights.ts, etc.) only need a one-line import change.
 *
 * Endpoint: https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{dist_nm}
 * - dist is in nautical miles (max 250 NM)
 * - No authentication required
 * - Rate limit: 1 request/second (our 10s poll interval is well within bounds)
 *
/** @see https://opendata.adsb.fi */

// All requests go through our Next.js server-side proxy at /api/flights
// to avoid CORS issues (ADS-B.fi does not send CORS headers).
const PROXY_API = "/api/flights";
const FETCH_TIMEOUT_MS = 15_000;
const ICAO24_REGEX = /^[0-9a-f]{6}$/i;
const NM_PER_DEG_LAT = 60;

// Re-export the shared FlightState type from opensky so callers don't need to
// change their type imports.
export type {
    FlightState,
    FetchResult,
    TrackFetchResult,
    FlightTrack,
    TrackWaypoint,
} from "@/lib/opensky";

import type {
    FlightState,
    FetchResult,
    TrackFetchResult,
} from "@/lib/opensky";

// ── ADS-B.fi response shape (subset of fields we care about) ─────────────────

type AdsbFiAircraft = {
    hex?: unknown;           // ICAO24 address (lowercase hex)
    flight?: unknown;        // callsign (padded with spaces)
    lat?: unknown;           // latitude WGS84
    lon?: unknown;           // longitude WGS84
    alt_baro?: unknown;      // barometric altitude in feet, or "ground"
    alt_geom?: unknown;      // geometric altitude in feet
    gs?: unknown;            // ground speed in knots
    track?: unknown;         // true track in degrees
    baro_rate?: unknown;     // vertical rate in ft/min
    squawk?: unknown;        // squawk code
    on_ground?: unknown;     // not always present; inferred from alt_baro
    category?: unknown;      // emitter category string e.g. "A1"
    r?: unknown;             // registration (used to infer origin country)
};

type AdsbFiResponse = {
    ac?: AdsbFiAircraft[];
    now?: number;
    total?: number;
    ctime?: number;
    ptime?: number;
};

// ── Unit conversion helpers ───────────────────────────────────────────────────

/** Feet → metres */
const ftToM = (ft: number) => ft * 0.3048;

/** Knots → m/s */
const ktsToMs = (kts: number) => kts * 0.51444;

/** ft/min → m/s */
const ftMinToMs = (ftMin: number) => ftMin / 196.85;

/** Degrees of latitude/longitude → nautical miles (conservative: uses lat). */
function degToNm(deg: number): number {
    return Math.abs(deg) * NM_PER_DEG_LAT;
}

// ── Emitter category letter → integer (mirrors OpenSky encoding) ──────────────
const CATEGORY_MAP: Record<string, number> = {
    A0: 1, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6, A7: 7,
    B0: 8, B1: 9, B2: 10, B3: 11, B4: 12, B5: 13, B6: 14, B7: 15,
    C0: 16, C1: 17, C2: 18, C3: 19,
    D0: 24,
};

// ── Parse a single aircraft entry ─────────────────────────────────────────────

function isFiniteNum(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

function parseAircraft(ac: AdsbFiAircraft): FlightState | null {
    const icao24 =
        typeof ac.hex === "string" ? ac.hex.toLowerCase().trim() : "";
    if (!ICAO24_REGEX.test(icao24)) return null;

    // Altitude — "ground" string means the aircraft is on the ground
    const altBaroRaw = ac.alt_baro;
    const onGround = altBaroRaw === "ground";
    const baroAltitudeFt =
        !onGround && isFiniteNum(altBaroRaw) ? altBaroRaw : null;
    const baroAltitude =
        baroAltitudeFt !== null ? ftToM(baroAltitudeFt) : null;

    const geoAltitudeFt = isFiniteNum(ac.alt_geom) ? ac.alt_geom : null;
    const geoAltitude = geoAltitudeFt !== null ? ftToM(geoAltitudeFt) : null;

    const latitude = isFiniteNum(ac.lat) ? ac.lat : null;
    const longitude = isFiniteNum(ac.lon) ? ac.lon : null;

    if (latitude === null || longitude === null) return null;

    const velocityKts = isFiniteNum(ac.gs) ? ac.gs : null;
    const velocity = velocityKts !== null ? ktsToMs(velocityKts) : null;

    const trueTrack = isFiniteNum(ac.track) ? ac.track : null;

    const vertRateFtMin = isFiniteNum(ac.baro_rate) ? ac.baro_rate : null;
    const verticalRate = vertRateFtMin !== null ? ftMinToMs(vertRateFtMin) : null;

    const callsign =
        typeof ac.flight === "string" ? ac.flight.trim() || null : null;
    const squawk =
        typeof ac.squawk === "string" ? ac.squawk.trim() || null : null;

    // Origin country: derive from registration prefix or leave as ICAO hex prefix
    const originCountry =
        typeof ac.r === "string" && ac.r.length > 0 ? ac.r.slice(0, 2) : "??";

    const category =
        typeof ac.category === "string"
            ? (CATEGORY_MAP[ac.category] ?? null)
            : null;

    return {
        icao24,
        callsign,
        originCountry,
        longitude,
        latitude,
        baroAltitude,
        onGround,
        velocity,
        trueTrack,
        verticalRate,
        geoAltitude,
        squawk,
        spiFlag: false,
        positionSource: 0,
        category,
    };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchWithTimeout(
    url: string,
    signal?: AbortSignal,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort);

    try {
        return await fetch(url, {
            cache: "no-store",
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onExternalAbort);
    }
}

// ── Public API (same interface as opensky.ts) ─────────────────────────────────

/**
 * Identical to the OpenSky version: returns [lamin, lamax, lomin, lomax].
 * Stored here so consumers import only from this module.
 */
export function bboxFromCenter(
    lng: number,
    lat: number,
    radiusDeg: number,
): [lamin: number, lamax: number, lomin: number, lomax: number] {
    const safe =
        Number.isFinite(radiusDeg) && radiusDeg > 0 ? radiusDeg : 2.49;
    return [lat - safe, lat + safe, lng - safe, lng + safe];
}

/**
 * Fetch flights within a bounding box.
 *
 * ADS-B.fi uses a radial query, so we derive the centre and a conservative
 * radius from the bbox, then optionally filter the response back to the bbox.
 */
export async function fetchFlightsByBbox(
    lamin: number,
    lamax: number,
    lomin: number,
    lomax: number,
    signal?: AbortSignal,
): Promise<FetchResult> {
    const centerLat = (lamin + lamax) / 2;
    const centerLon = (lomin + lomax) / 2;

    // Conservative radius: half the longer diagonal side, in NM (capped at 250).
    const halfLatDeg = (lamax - lamin) / 2;
    const halfLonDeg = (lomax - lomin) / 2;
    const radiusNm = Math.min(
        250,
        Math.ceil(Math.max(degToNm(halfLatDeg), degToNm(halfLonDeg)) * 1.05),
    );

    const url = `${PROXY_API}?lat=${centerLat}&lon=${centerLon}&dist=${radiusNm}`;

    try {
        const res = await fetchWithTimeout(url, signal);

        if (res.status === 429) {
            return {
                flights: [],
                rateLimited: true,
                creditsRemaining: null,
                retryAfterSeconds: 10,
            };
        }

        if (!res.ok) {
            return {
                flights: [],
                rateLimited: false,
                creditsRemaining: null,
                retryAfterSeconds: null,
            };
        }

        const payload = (await res.json()) as unknown;
        const data =
            typeof payload === "object" && payload !== null
                ? (payload as AdsbFiResponse)
                : {};

        const aircraftList = Array.isArray(data.ac) ? data.ac : [];

        const flights = aircraftList
            .map(parseAircraft)
            .filter((f): f is FlightState => f !== null)
            .filter(
                (f) =>
                    !f.onGround &&
                    f.baroAltitude !== null &&
                    // Clip back to the original bbox
                    f.latitude! >= lamin &&
                    f.latitude! <= lamax &&
                    f.longitude! >= lomin &&
                    f.longitude! <= lomax,
            );

        return {
            flights,
            rateLimited: false,
            creditsRemaining: null,
            retryAfterSeconds: null,
        };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        return {
            flights: [],
            rateLimited: false,
            creditsRemaining: null,
            retryAfterSeconds: null,
        };
    }
}

/**
 * Fetch a single aircraft by ICAO24.
 * ADS-B.fi doesn't have a per-aircraft endpoint, so we use a small bbox
 * around a global point. As a practical workaround we query the global feed
 * and filter — only feasible for the use case in use-flight-track.ts.
 *
 * Returns null if anything goes wrong (no flight found).
 */
export async function fetchFlightByIcao24(
    icao24: string,
    signal?: AbortSignal,
): Promise<{ flight: FlightState | null; creditsRemaining: number | null }> {
    const normalized = icao24.trim().toLowerCase();
    if (!ICAO24_REGEX.test(normalized)) {
        return { flight: null, creditsRemaining: null };
    }

    // Query a large radius globally — adsb.fi has no per-icao24 endpoint.
    // We use a 250 NM radius from (0, 0) which won't help much, so instead
    // we broadcast the search by trying the currently active region via a
    // best-effort approach: return null and let use-flight-track.ts degrade.
    // TODO: improve with a session-level "last known position" cache.
    return { flight: null, creditsRemaining: null };
}

/**
 * Fetch by callsign — not natively supported, returns null gracefully.
 * The FPV tracking path will fall back to searching the current bbox poll.
 */
export async function fetchFlightByCallsign(
    _callsign: string,
    _signal?: AbortSignal,
): Promise<{
    flight: FlightState | null;
    creditsRemaining: number | null;
    rateLimited: boolean;
    retryAfterSeconds: number | null;
}> {
    return {
        flight: null,
        creditsRemaining: null,
        rateLimited: false,
        retryAfterSeconds: null,
    };
}

/**
 * Track endpoint — not available on ADS-B.fi public API.
 * Returns null gracefully so the UI degrades without crashing.
 */
export async function fetchTrackByIcao24(
    _icao24: string,
    _time = 0,
    _signal?: AbortSignal,
): Promise<TrackFetchResult> {
    return {
        track: null,
        rateLimited: false,
        creditsRemaining: null,
        retryAfterSeconds: null,
    };
}

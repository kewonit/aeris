import type {
  FlightTrack,
  OpenSkyTrackResponse,
  TrackFetchResult,
  TrackWaypoint,
} from "./opensky-types";
import { FETCH_TIMEOUT_MS, ICAO24_REGEX, OPENSKY_API } from "./opensky-types";
import { parseRateLimitInfo } from "./opensky-parsing";

// ── Track Waypoint Parsing ─────────────────────────────────────────────

function parseTrackWaypoint(raw: unknown): TrackWaypoint | null {
  if (!Array.isArray(raw) || raw.length < 6) return null;

  const time =
    typeof raw[0] === "number" && Number.isFinite(raw[0]) ? raw[0] : null;
  const rawLat =
    typeof raw[1] === "number" && Number.isFinite(raw[1]) ? raw[1] : null;
  const rawLng =
    typeof raw[2] === "number" && Number.isFinite(raw[2]) ? raw[2] : null;
  const latitude =
    rawLat !== null && rawLat >= -90 && rawLat <= 90 ? rawLat : null;
  const longitude =
    rawLng !== null && rawLng >= -180 && rawLng <= 180 ? rawLng : null;
  const baroAltitude =
    typeof raw[3] === "number" && Number.isFinite(raw[3]) ? raw[3] : null;
  const trueTrack =
    typeof raw[4] === "number" && Number.isFinite(raw[4]) ? raw[4] : null;
  const onGround = raw[5] === true;

  if (time === null) return null;
  return { time, latitude, longitude, baroAltitude, trueTrack, onGround };
}

// ── Flight Track Parsing ───────────────────────────────────────────────

function parseFlightTrack(
  icao24: string,
  payload: unknown,
): FlightTrack | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as OpenSkyTrackResponse;

  const startTime =
    typeof data.startTime === "number" && Number.isFinite(data.startTime)
      ? data.startTime
      : 0;
  const endTime =
    typeof data.endTime === "number" && Number.isFinite(data.endTime)
      ? data.endTime
      : 0;

  const callsignRaw =
    typeof data.callsign === "string"
      ? data.callsign
      : typeof data.calllsign === "string"
        ? data.calllsign
        : null;
  const callsign = callsignRaw ? callsignRaw.trim() || null : null;

  const rawPath = Array.isArray(data.path) ? data.path : [];
  const parsed = rawPath
    .map(parseTrackWaypoint)
    .filter((p): p is TrackWaypoint => p !== null)
    .filter((p) => p.latitude !== null && p.longitude !== null);

  // Be defensive: some responses can be out-of-order.
  parsed.sort((a, b) => a.time - b.time);

  // Remove consecutive duplicates (helps avoid long straight chords when data is jittery).
  const path: TrackWaypoint[] = [];
  let lastLng: number | null = null;
  let lastLat: number | null = null;
  for (const p of parsed) {
    if (lastLng !== null && lastLat !== null) {
      if (p.longitude === lastLng && p.latitude === lastLat) continue;
    }
    path.push(p);
    lastLng = p.longitude;
    lastLat = p.latitude;
  }

  if (path.length < 2) return null;

  return {
    icao24,
    startTime,
    endTime,
    callsign,
    path,
  };
}

// ── Fetch Track ────────────────────────────────────────────────────────

/**
 * Fetch a flight track (trajectory) for an aircraft.
 *
 * Uses the experimental OpenSky tracks endpoint. For live flights, pass time=0
 * which returns the current (ongoing) track if available.
 */
export async function fetchTrackByIcao24(
  icao24: string,
  time: number = 0,
  signal?: AbortSignal,
): Promise<TrackFetchResult> {
  const normalizedIcao24 = icao24.trim().toLowerCase();
  if (!ICAO24_REGEX.test(normalizedIcao24)) {
    return {
      track: null,
      rateLimited: false,
      creditsRemaining: null,
      retryAfterSeconds: null,
    };
  }

  const safeTime = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  if (signal?.aborted) {
    onExternalAbort();
  }

  try {
    async function fetchWithTime(
      t: number,
    ): Promise<{ result: TrackFetchResult; notFound: boolean }> {
      const urlAll = `${OPENSKY_API}/tracks/all?icao24=${encodeURIComponent(normalizedIcao24)}&time=${t}`;
      const urlFallback = `${OPENSKY_API}/tracks?icao24=${encodeURIComponent(normalizedIcao24)}&time=${t}`;

      async function attempt(
        url: string,
      ): Promise<{ result: TrackFetchResult; status: number }> {
        const res = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });

        const rateLimitInfo = parseRateLimitInfo(res);

        if (res.status === 429) {
          return {
            status: res.status,
            result: {
              track: null,
              rateLimited: true,
              creditsRemaining: rateLimitInfo.creditsRemaining,
              retryAfterSeconds: rateLimitInfo.retryAfterSeconds,
            },
          };
        }

        if (res.status === 404 || res.status === 401 || res.status === 403) {
          return {
            status: res.status,
            result: {
              track: null,
              rateLimited: false,
              creditsRemaining: rateLimitInfo.creditsRemaining,
              retryAfterSeconds: null,
            },
          };
        }

        if (!res.ok) {
          return {
            status: res.status,
            result: {
              track: null,
              rateLimited: false,
              creditsRemaining: rateLimitInfo.creditsRemaining,
              retryAfterSeconds: null,
            },
          };
        }

        const payload = (await res.json()) as unknown;
        return {
          status: res.status,
          result: {
            track: parseFlightTrack(normalizedIcao24, payload),
            rateLimited: false,
            creditsRemaining: rateLimitInfo.creditsRemaining,
            retryAfterSeconds: null,
          },
        };
      }

      const primary = await attempt(urlAll);
      if (primary.result.track || primary.result.rateLimited) {
        return { result: primary.result, notFound: false };
      }

      // Some OpenSky deployments/documentation use `/tracks` instead of `/tracks/all`.
      // Fall back only when the primary endpoint is missing (404), not on auth failures.
      if (primary.status === 404) {
        const fallback = await attempt(urlFallback);
        // Only treat as "not found" if both endpoints return 404.
        const notFound = fallback.status === 404;
        return { result: fallback.result, notFound };
      }

      return { result: primary.result, notFound: false };
    }

    const primary = await fetchWithTime(safeTime);
    if (primary.result.track || primary.result.rateLimited || safeTime !== 0) {
      return primary.result;
    }

    // Per OpenSky docs: `time` can be any time between the start and end of a known flight.
    // `time=0` only returns a live track if OpenSky considers a flight ongoing. If that lookup
    // fails with a not-found response, retry once with the current timestamp.
    if (!primary.notFound) {
      return primary.result;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > 0) {
      const retry = await fetchWithTime(nowSec);
      return retry.result;
    }

    return primary.result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // Abort is expected on effect cleanup or request timeouts. Treat it as a
      // normal cancellation and return an empty result.
    }
    return {
      track: null,
      rateLimited: false,
      creditsRemaining: null,
      retryAfterSeconds: null,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

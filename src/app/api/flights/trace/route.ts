import { type NextRequest, NextResponse } from "next/server";
import type { FlightTrack, TrackWaypoint } from "@/lib/opensky-types";

// ── Constants ──────────────────────────────────────────────────────────

const HEX_REGEX = /^[0-9a-f]{6}$/;
const FT_TO_M = 0.3048;
const TRACE_TIMEOUT_MS = 10_000;
const OPENSKY_TIMEOUT_MS = 8_000;

const TARGET_WAYPOINTS = 120;
const MAX_AGE_SECONDS = 120 * 60;

const GLOBE_TRACE_SOURCES = [
  {
    name: "airplanes.live",
    baseUrl: "https://globe.airplanes.live/data/traces",
    referer: "https://globe.airplanes.live/",
    origin: "https://globe.airplanes.live",
  },
  {
    name: "adsb.lol",
    baseUrl: "https://globe.adsb.lol/data/traces",
    referer: "https://globe.adsb.lol/",
    origin: "https://globe.adsb.lol",
  },
  {
    name: "adsb.fi",
    baseUrl: "https://globe.adsb.fi/data/traces",
    referer: "https://globe.adsb.fi/",
    origin: "https://globe.adsb.fi",
  },
] as const;

const OPENSKY_API = "https://opensky-network.org/api";

const APP_UA = "Aeris/1.0 (flight-tracker; +https://github.com/kewonit/aeris)";

// trace[i] = [offset_sec, lat, lng, alt_ft|"ground"|null, gs, track, flags, vrate, ...]
// flags bit 0 = stale
/**
 * Trim waypoints to only the last flight leg.
 *
 * Finds the last ground→airborne transition (requiring at least
 * `MIN_GROUND_FOR_SPLIT` consecutive ground points to avoid false
 * triggers from GPS noise). Includes one ground waypoint before
 * takeoff as a departure airport anchor so the trail visually
 * starts at the runway.
 *
 * If no multi-point ground segment is found (single-leg flight or
 * all-airborne trace), returns the input unchanged.
 */
const MIN_GROUND_FOR_SPLIT = 2;

function trimToLastFlight(waypoints: TrackWaypoint[]): TrackWaypoint[] {
  if (waypoints.length < 3) return waypoints;

  let lastTakeoffIdx = -1;

  for (let i = 1; i < waypoints.length; i++) {
    if (!waypoints[i].onGround && waypoints[i - 1].onGround) {
      // Count consecutive ground points before this transition
      let groundCount = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (waypoints[j].onGround) groundCount++;
        else break;
      }
      if (groundCount >= MIN_GROUND_FOR_SPLIT) {
        lastTakeoffIdx = i;
      }
    }
  }

  if (lastTakeoffIdx <= 0) return waypoints;

  // Include one ground point before takeoff as departure anchor
  const startIdx = Math.max(0, lastTakeoffIdx - 1);
  return waypoints.slice(startIdx);
}

function parseReadsbTrace(hex: string, data: unknown): FlightTrack | null {
  if (typeof data !== "object" || data === null) return null;

  const obj = data as Record<string, unknown>;
  const timestamp =
    typeof obj.timestamp === "number" && Number.isFinite(obj.timestamp)
      ? obj.timestamp
      : 0;

  if (timestamp <= 0) return null;

  const rawTrace = Array.isArray(obj.trace) ? obj.trace : null;
  if (!rawTrace || rawTrace.length < 2) return null;

  let latestOffset = 0;
  for (const entry of rawTrace) {
    if (Array.isArray(entry) && typeof entry[0] === "number") {
      if (entry[0] > latestOffset) latestOffset = entry[0];
    }
  }
  const cutoffOffset = latestOffset - MAX_AGE_SECONDS;

  // ── Pre-scan: find the last new-leg marker (flags & 2) ─────────
  // readsb sets this flag at the start of a new flight leg, which is
  // the most reliable signal for detecting the last departure.
  // See: https://github.com/wiedehopf/readsb/blob/dev/README-json.md
  let lastNewLegOffset = -Infinity;
  let hasNewLegFlag = false;

  for (const entry of rawTrace) {
    if (!Array.isArray(entry) || entry.length < 7) continue;
    const offset = typeof entry[0] === "number" ? entry[0] : null;
    if (offset === null || !Number.isFinite(offset)) continue;
    if (offset < cutoffOffset) continue;
    const flags = typeof entry[6] === "number" ? entry[6] : 0;
    if (flags & 1) continue; // skip stale
    if (flags & 2) {
      lastNewLegOffset = offset;
      hasNewLegFlag = true;
    }
  }

  // Allow up to 90 seconds before the new-leg marker so that the
  // departure airport position is included as an anchor point.
  const NEW_LEG_ANCHOR_SEC = 90;
  const legCutoff = hasNewLegFlag
    ? lastNewLegOffset - NEW_LEG_ANCHOR_SEC
    : -Infinity;

  const waypoints: TrackWaypoint[] = [];

  for (const entry of rawTrace) {
    if (!Array.isArray(entry) || entry.length < 4) continue;

    const offset = typeof entry[0] === "number" ? entry[0] : null;
    if (offset === null || !Number.isFinite(offset)) continue;

    if (offset < cutoffOffset) continue;

    // Skip entries before the last flight leg
    if (offset < legCutoff) continue;

    const lat = typeof entry[1] === "number" ? entry[1] : null;
    const lng = typeof entry[2] === "number" ? entry[2] : null;
    if (lat === null || lng === null) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const rawAlt = entry[3];
    const onGround = rawAlt === "ground";
    let baroAltitude: number | null = null;
    if (onGround) {
      baroAltitude = 0;
    } else if (typeof rawAlt === "number" && Number.isFinite(rawAlt)) {
      baroAltitude = rawAlt * FT_TO_M;
    }

    const trueTrack =
      entry.length > 5 &&
      typeof entry[5] === "number" &&
      Number.isFinite(entry[5])
        ? entry[5]
        : null;

    const flags =
      entry.length > 6 && typeof entry[6] === "number" ? entry[6] : 0;

    // Skip stale positions (bit 0)
    if (flags & 1) continue;

    const time = timestamp + offset;

    waypoints.push({
      time,
      latitude: lat,
      longitude: lng,
      baroAltitude,
      trueTrack,
      onGround,
    });
  }

  if (waypoints.length < 2) return null;

  waypoints.sort((a, b) => a.time - b.time);

  // If no new-leg flag was found, fall back to onGround detection
  // to trim to the last flight leg.
  const legTrimmed = hasNewLegFlag ? waypoints : trimToLastFlight(waypoints);

  const deduped: TrackWaypoint[] = [legTrimmed[0]];
  for (let i = 1; i < legTrimmed.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = legTrimmed[i];
    // Skip exact duplicates and near-duplicates (< ~30m apart) from GPS jitter.
    const dlat = (curr.latitude ?? 0) - (prev.latitude ?? 0);
    const dlng = (curr.longitude ?? 0) - (prev.longitude ?? 0);
    if (dlat * dlat + dlng * dlng < 0.0003 * 0.0003) {
      // Keep the later point if it has better altitude data.
      if (curr.baroAltitude != null && prev.baroAltitude == null) {
        deduped[deduped.length - 1] = curr;
      }
      continue;
    }
    deduped.push(curr);
  }

  if (deduped.length < 2) return null;

  const sampled = downsampleUniform(deduped, TARGET_WAYPOINTS);

  return {
    icao24: hex.toLowerCase(),
    startTime: Math.floor(sampled[0].time),
    endTime: Math.floor(sampled[sampled.length - 1].time),
    callsign: null,
    path: sampled,
  };
}

function downsampleUniform(
  points: TrackWaypoint[],
  target: number,
): TrackWaypoint[] {
  if (points.length <= target) return points;

  const result: TrackWaypoint[] = [points[0]];
  const step = (points.length - 1) / (target - 1);

  for (let i = 1; i < target - 1; i++) {
    result.push(points[Math.round(i * step)]);
  }

  result.push(points[points.length - 1]);
  return result;
}

function parseOpenSkyTrack(hex: string, data: unknown): FlightTrack | null {
  if (typeof data !== "object" || data === null) return null;

  const obj = data as Record<string, unknown>;
  const startTime =
    typeof obj.startTime === "number" && Number.isFinite(obj.startTime)
      ? obj.startTime
      : 0;
  const endTime =
    typeof obj.endTime === "number" && Number.isFinite(obj.endTime)
      ? obj.endTime
      : 0;

  const callsignRaw =
    typeof obj.callsign === "string"
      ? obj.callsign
      : typeof (obj as Record<string, unknown>).calllsign === "string"
        ? ((obj as Record<string, unknown>).calllsign as string)
        : null;
  const callsign = callsignRaw ? callsignRaw.trim() || null : null;

  const rawPath = Array.isArray(obj.path) ? obj.path : [];

  const waypoints: TrackWaypoint[] = [];
  for (const raw of rawPath) {
    if (!Array.isArray(raw) || raw.length < 6) continue;

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

    if (time === null || latitude === null || longitude === null) continue;
    waypoints.push({
      time,
      latitude,
      longitude,
      baroAltitude,
      trueTrack,
      onGround,
    });
  }

  waypoints.sort((a, b) => a.time - b.time);

  // Trim to the last flight leg using onGround detection
  const legTrimmed = trimToLastFlight(waypoints);

  const deduped: TrackWaypoint[] = [];
  let lastLng: number | null = null;
  let lastLat: number | null = null;
  for (const p of legTrimmed) {
    if (lastLng !== null && lastLat !== null) {
      // Skip exact duplicates and near-duplicates (< ~30m).
      const dlat = (p.latitude ?? 0) - lastLat;
      const dlng = (p.longitude ?? 0) - lastLng;
      if (dlat * dlat + dlng * dlng < 0.0003 * 0.0003) continue;
    }
    deduped.push(p);
    lastLng = p.longitude;
    lastLat = p.latitude;
  }

  if (deduped.length < 2) return null;

  const sampled = downsampleUniform(deduped, TARGET_WAYPOINTS);

  return {
    icao24: hex,
    startTime,
    endTime,
    callsign,
    path: sampled,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hex = request.nextUrl.searchParams.get("hex")?.trim().toLowerCase();

  if (!hex || !HEX_REGEX.test(hex)) {
    return NextResponse.json(
      { error: "Invalid or missing 'hex' parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const lastTwo = hex.slice(-2);

  const traceHeaders = (source: (typeof GLOBE_TRACE_SOURCES)[number]) => ({
    Accept: "application/json",
    "User-Agent": APP_UA,
    Referer: source.referer,
    Origin: source.origin,
  });

  for (const source of GLOBE_TRACE_SOURCES) {
    // Try trace_full first (complete flight history), then trace_recent
    // as fallback (last ~few minutes, still useful for active flights).
    const urlsToTry = [
      `${source.baseUrl}/${lastTwo}/trace_full_${hex}.json`,
      `${source.baseUrl}/${lastTwo}/trace_recent_${hex}.json`,
    ];

    for (const traceUrl of urlsToTry) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS);

        const res = await fetch(traceUrl, {
          signal: controller.signal,
          headers: traceHeaders(source),
        });
        clearTimeout(timer);

        if (res.ok) {
          // Skip non-JSON responses (CloudFlare challenges, maintenance pages)
          const ct = res.headers.get("content-type") ?? "";
          if (ct.includes("text/html") || ct.includes("text/xml")) continue;

          const data = (await res.json()) as unknown;
          const track = parseReadsbTrace(hex, data);
          if (track && track.path.length >= 2) {
            return NextResponse.json(
              { track, source: source.name },
              { headers: { "Cache-Control": "private, max-age=30" } },
            );
          }
        }
      } catch {
        // Next URL / source
      }
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENSKY_TIMEOUT_MS);

    const res = await fetch(
      `${OPENSKY_API}/tracks/all?icao24=${encodeURIComponent(hex)}&time=0`,
      {
        signal: controller.signal,
        cache: "no-store",
      },
    );

    clearTimeout(timer);

    if (res.status === 429) {
      return NextResponse.json(
        { error: "Rate limited" },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": "60" },
        },
      );
    }

    if (res.ok) {
      // Reject non-JSON responses (CloudFlare challenge pages)
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/html") || ct.includes("text/xml")) {
        return NextResponse.json(
          { track: null, source: null },
          { status: 200, headers: { "Cache-Control": "private, max-age=30" } },
        );
      }

      const data = (await res.json()) as unknown;
      const track = parseOpenSkyTrack(hex, data);
      if (track && track.path.length >= 2) {
        return NextResponse.json(
          { track, source: "opensky" },
          { headers: { "Cache-Control": "private, max-age=60" } },
        );
      }
    }
  } catch {}

  return NextResponse.json(
    { track: null, source: null },
    { status: 200, headers: { "Cache-Control": "private, max-age=30" } },
  );
}

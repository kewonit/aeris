import { type NextRequest, NextResponse } from "next/server";
import type { FlightTrack, TrackWaypoint } from "@/lib/opensky-types";

// ── Constants ──────────────────────────────────────────────────────────

const HEX_REGEX = /^[0-9a-f]{6}$/;
const FT_TO_M = 0.3048;
const TRACE_TIMEOUT_MS = 10_000;
const OPENSKY_TIMEOUT_MS = 8_000;

const TARGET_WAYPOINTS = 60;
const MAX_AGE_SECONDS = 90 * 60;

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

let lastRequestTime = 0;
const RATE_MS = 800;

// trace[i] = [offset_sec, lat, lng, alt_ft|"ground"|null, gs, track, flags, vrate, ...]
// flags bit 0 = stale
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

  const waypoints: TrackWaypoint[] = [];

  for (const entry of rawTrace) {
    if (!Array.isArray(entry) || entry.length < 4) continue;

    const offset = typeof entry[0] === "number" ? entry[0] : null;
    if (offset === null || !Number.isFinite(offset)) continue;

    if (offset < cutoffOffset) continue;

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

  const deduped: TrackWaypoint[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = waypoints[i];
    if (prev.latitude === curr.latitude && prev.longitude === curr.longitude) {
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

  const deduped: TrackWaypoint[] = [];
  let lastLng: number | null = null;
  let lastLat: number | null = null;
  for (const p of waypoints) {
    if (lastLng !== null && lastLat !== null) {
      if (p.longitude === lastLng && p.latitude === lastLat) continue;
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

  const now = Date.now();
  const elapsed = now - lastRequestTime;
  lastRequestTime = now;
  if (elapsed < RATE_MS) {
    return NextResponse.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": "1" },
      },
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
    try {
      const fullUrl = `${source.baseUrl}/${lastTwo}/trace_full_${hex}.json`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS);

      const res = await fetch(fullUrl, {
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
      // Next source
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

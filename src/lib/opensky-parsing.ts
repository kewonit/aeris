import type {
  FlightState,
  OpenSkyResponse,
  ParseStateOptions,
  RateLimitInfo,
} from "./opensky-types";
import { ICAO24_REGEX, clamp } from "./opensky-types";

// ── Header Parsing ─────────────────────────────────────────────────────

export function parseIntegerHeader(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRateLimitInfo(response: Response): RateLimitInfo {
  return {
    creditsRemaining: parseIntegerHeader(
      response.headers.get("x-rate-limit-remaining"),
    ),
    retryAfterSeconds: parseIntegerHeader(
      response.headers.get("x-rate-limit-retry-after-seconds"),
    ),
  };
}

// ── Value Helpers ──────────────────────────────────────────────────────

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeBounds(
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

// ── State Row Parsing ──────────────────────────────────────────────────

export function parseStateRow(
  rawState: (string | number | boolean | null)[],
): FlightState | null {
  if (rawState.length < 17) return null;

  const icao24 =
    typeof rawState[0] === "string" ? rawState[0].toLowerCase() : "";
  if (!ICAO24_REGEX.test(icao24)) return null;

  const longitude = isFiniteNumber(rawState[5]) ? rawState[5] : null;
  const latitude = isFiniteNumber(rawState[6]) ? rawState[6] : null;
  const baroAltitude = isFiniteNumber(rawState[7]) ? rawState[7] : null;

  return {
    icao24,
    callsign:
      typeof rawState[1] === "string" ? rawState[1].trim() || null : null,
    originCountry: typeof rawState[2] === "string" ? rawState[2] : "Unknown",
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

export function parseStates(
  raw: OpenSkyResponse,
  options?: ParseStateOptions,
): FlightState[] {
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

// ── Callsign Normalization ─────────────────────────────────────────────

export function normalizeCallsign(value: string | null): string {
  if (!value) return "";
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

// ── readsb Parser ────────────────────────────────────────────────────
//
// Converts raw readsb JSON (RawAircraft[]) → FlightState[].
// Handles unit conversions, edge cases, and stale-position filtering.
// Works identically for Airplanes.live and adsb.lol responses.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "./opensky-types";
import type { RawAircraft } from "./flight-api-types";
import { MAX_POSITION_AGE_S } from "./flight-api-types";

// ── Unit Conversion Constants ──────────────────────────────────────────

/** Feet → Meters */
const FT_TO_M = 0.3048;

/** Knots → Meters per second */
const KT_TO_MS = 0.514444;

/** Feet per minute → Meters per second */
const FTPM_TO_MS = 0.00508;

// ── Registration → Country Lookup ──────────────────────────────────────
//
// readsb doesn't provide originCountry. We derive it from the
// registration prefix. Sorted by prefix length descending so longer
// prefixes match first (e.g. "EC-" before "E").

const REG_PREFIX_TO_COUNTRY: readonly [string, string][] = [
  // 3-char prefixes
  ["EC-", "Spain"],
  ["HB-", "Switzerland"],
  ["OE-", "Austria"],
  ["PH-", "Netherlands"],
  ["SE-", "Sweden"],
  ["OY-", "Denmark"],
  ["OH-", "Finland"],
  ["LN-", "Norway"],
  ["9V-", "Singapore"],
  ["9M-", "Malaysia"],
  ["HS-", "Thailand"],
  ["PK-", "Indonesia"],
  ["VH-", "Australia"],
  ["ZK-", "New Zealand"],
  ["PP-", "Brazil"],
  ["PT-", "Brazil"],
  ["XA-", "Mexico"],
  ["LV-", "Argentina"],
  ["A6-", "UAE"],
  ["A7-", "Qatar"],
  ["HZ-", "Saudi Arabia"],
  ["4X-", "Israel"],
  ["TC-", "Turkey"],
  ["SU-", "Egypt"],
  ["5N-", "Nigeria"],
  ["ZS-", "South Africa"],
  ["AP-", "Pakistan"],
  ["EI-", "Ireland"],
  ["OO-", "Belgium"],
  ["CS-", "Portugal"],
  ["SX-", "Greece"],
  ["SP-", "Poland"],
  ["OK-", "Czech Republic"],
  ["HA-", "Hungary"],
  ["YR-", "Romania"],
  ["UR-", "Ukraine"],
  ["RA-", "Russia"],
  ["VP-", "Bermuda"],
  // 2-char prefixes
  ["C-", "Canada"],
  ["G-", "United Kingdom"],
  ["D-", "Germany"],
  ["F-", "France"],
  ["I-", "Italy"],
  ["B-", "China"],
  // 2-char prefixes (no hyphen)
  ["JA", "Japan"],
  ["HL", "South Korea"],
  ["VT", "India"],
  // 1-char prefix
  ["N", "United States"],
];

// Pre-build Maps by prefix length for O(1) lookup instead of O(42) linear scan
const REG_BY_3 = new Map<string, string>();
const REG_BY_2 = new Map<string, string>();
const REG_BY_1 = new Map<string, string>();
for (const [prefix, country] of REG_PREFIX_TO_COUNTRY) {
  if (prefix.length >= 3) REG_BY_3.set(prefix, country);
  else if (prefix.length === 2) REG_BY_2.set(prefix, country);
  else REG_BY_1.set(prefix, country);
}

function countryFromRegistration(reg: string | undefined): string {
  if (!reg) return "Unknown";
  const upper = reg.toUpperCase();
  return (
    REG_BY_3.get(upper.slice(0, 3)) ??
    REG_BY_2.get(upper.slice(0, 2)) ??
    REG_BY_1.get(upper[0]) ??
    "Unknown"
  );
}

// ── Category Conversion ────────────────────────────────────────────────
//
// Converts readsb category string ("A0"–"D7") to the numeric encoding
// used by OpenSky (DO-260B spec). A-set: A0→0, A1→2(light)…A7→8(rotorcraft).
// B-set: B0→0, B1→9(glider)…B7→15(space). C-set: surface vehicles. D: reserved.

function readsbCategoryToNumber(cat: string | undefined): number | null {
  if (!cat || cat.length !== 2) return null;

  const set = cat.charAt(0).toUpperCase();
  const idx = Number.parseInt(cat.charAt(1), 10);
  if (!Number.isFinite(idx) || idx < 0 || idx > 7) return null;

  switch (set) {
    case "A":
      return idx === 0 ? 0 : idx + 1;
    case "B":
      return idx === 0 ? 0 : idx + 8;
    case "C":
      return idx === 0 ? 0 : idx + 15;
    case "D":
      return 0;
    default:
      return null;
  }
}

// ── Position Source Mapping ─────────────────────────────────────────────

/** Maps readsb `type` field to OpenSky positionSource: 0=ADS-B, 1=MLAT, 2=TIS-B */

function readsbTypeToPositionSource(type: string | undefined): number {
  if (!type) return 0;
  if (type === "mlat") return 1;
  if (type.startsWith("tisb")) return 2;
  return 0;
}

// ── Altitude Parser ────────────────────────────────────────────────────

function parseAltBaro(value: number | "ground" | undefined): {
  altitude: number | null;
  onGround: boolean;
} {
  if (value === "ground") return { altitude: 0, onGround: true };
  if (typeof value === "number" && Number.isFinite(value))
    return { altitude: value * FT_TO_M, onGround: false };
  return { altitude: null, onGround: false };
}

// ── ICAO Hex Validation ────────────────────────────────────────────────

const ICAO_HEX_RE = /^[0-9a-f]{6}$/i;

function isValidIcaoHex(hex: string): boolean {
  // Filter out '~'-prefixed non-ICAO addresses and invalid formats
  return !hex.startsWith("~") && ICAO_HEX_RE.test(hex);
}

// ── Optional Finite Helper ─────────────────────────────────────────────

/** Returns the value if it's a finite number, otherwise null. */
function optionalFinite(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── Single Aircraft Parser ─────────────────────────────────────────────

function parseRawAircraft(raw: RawAircraft): FlightState | null {
  // Reject non-ICAO addresses (TIS-B, etc.)
  if (!isValidIcaoHex(raw.hex)) return null;

  // Require a valid position within geographic bounds
  if (typeof raw.lat !== "number" || typeof raw.lon !== "number") return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  if (raw.lat < -90 || raw.lat > 90 || raw.lon < -180 || raw.lon > 180)
    return null;

  // Filter stale positions (>60s old)
  if (typeof raw.seen_pos === "number" && raw.seen_pos > MAX_POSITION_AGE_S)
    return null;

  const { altitude, onGround } = parseAltBaro(raw.alt_baro);

  return {
    icao24: raw.hex.toLowerCase(),
    callsign: raw.flight?.trim() || null,
    originCountry: countryFromRegistration(raw.r),
    longitude: raw.lon,
    latitude: raw.lat,
    baroAltitude: altitude,
    onGround,
    velocity:
      typeof raw.gs === "number" && Number.isFinite(raw.gs)
        ? raw.gs * KT_TO_MS
        : null,
    trueTrack:
      typeof raw.track === "number" && Number.isFinite(raw.track)
        ? raw.track
        : null,
    verticalRate:
      typeof raw.baro_rate === "number" && Number.isFinite(raw.baro_rate)
        ? raw.baro_rate * FTPM_TO_MS
        : null,
    geoAltitude:
      typeof raw.alt_geom === "number" && Number.isFinite(raw.alt_geom)
        ? raw.alt_geom * FT_TO_M
        : null,
    squawk: raw.squawk ?? null,
    spiFlag: raw.spi === 1,
    positionSource: readsbTypeToPositionSource(raw.type),
    category: readsbCategoryToNumber(raw.category),
    typeCode: raw.t?.trim() || null,
    registration: raw.r?.trim() || null,

    // ── Avionics (readsb-only, will be undefined for OpenSky) ──────
    ias: optionalFinite(raw.ias),
    tas: optionalFinite(raw.tas),
    mach: optionalFinite(raw.mach),
    roll: optionalFinite(raw.roll),
    trackRate: optionalFinite(raw.track_rate),
    magHeading: optionalFinite(raw.mag_heading),

    // ── Navigation intent ──────────────────────────────────────────
    navAltitudeMcp: optionalFinite(raw.nav_altitude_mcp),
    navAltitudeFms: optionalFinite(raw.nav_altitude_fms),
    navHeading: optionalFinite(raw.nav_heading),
    navQnh: optionalFinite(raw.nav_qnh),
    navModes: raw.nav_modes && raw.nav_modes.length > 0 ? raw.nav_modes : null,

    // ── Atmospheric ────────────────────────────────────────────────
    windDirection: optionalFinite(raw.wd),
    windSpeed: optionalFinite(raw.ws),
    oat: optionalFinite(raw.oat),

    // ── Classification ─────────────────────────────────────────────
    dbFlags: typeof raw.dbFlags === "number" ? raw.dbFlags : null,
    emergencyStatus:
      raw.emergency && raw.emergency !== "none" ? raw.emergency : null,
    typeDescription: raw.desc?.trim() || null,
  };
}

// ── Batch Parser ───────────────────────────────────────────────────────

export interface ParseOptions {
  /** Include aircraft on the ground. Default: false. */
  includeGround?: boolean;
  /** Require barometric altitude. Default: true. */
  requireBaroAltitude?: boolean;
}

/**
 * Parses an array of raw readsb aircraft entries into FlightState[].
 * Handles unit conversions, filters stale/invalid positions, and
 * converts category strings to numeric codes for backward compatibility.
 */
export function parseAircraftList(
  rawList: RawAircraft[],
  options?: ParseOptions,
): FlightState[] {
  const includeGround = options?.includeGround ?? false;
  const requireBaroAltitude = options?.requireBaroAltitude ?? true;

  const results: FlightState[] = [];

  for (const raw of rawList) {
    if (!raw || typeof raw !== "object") continue;
    const state = parseRawAircraft(raw);
    if (!state) continue;

    // Filter ground aircraft unless specifically requested
    if (!includeGround && state.onGround) continue;

    // Filter aircraft without barometric altitude if required
    if (requireBaroAltitude && state.baroAltitude === null) continue;

    results.push(state);
  }

  return results;
}

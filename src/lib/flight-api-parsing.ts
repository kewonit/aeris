// ── readsb Parser ────────────────────────────────────────────────────
//
// Converts raw readsb JSON (RawAircraft[]) → FlightState[].
// Handles unit conversions, edge cases, and stale-position filtering.
// Works identically for airplanes.live, adsb.lol, and adsb.fi responses.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState, PositionSource } from "./opensky-types";
import type { RawAircraft } from "./flight-api-types";
import { MAX_POSITION_AGE_S } from "./flight-api-types";
import {
  createFlightProvenance,
  normalizeFlightTimestamp,
} from "./flight-provenance";

// ── Unit Conversion Constants ──────────────────────────────────────────

/** Feet → Meters */
const FT_TO_M = 0.3048;

/** Knots → Meters per second */
const KT_TO_MS = 0.514444;

/** Feet per minute → Meters per second */
const FTPM_TO_MS = 0.00508;

// ── Registration → Country Lookup ──────────────────────────────────────
//
// readsb does not provide registrationCountry. We derive it from the
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

function countryFromRegistration(reg: unknown): string | null {
  if (typeof reg !== "string" || !reg) return null;
  const upper = reg.toUpperCase();
  return (
    REG_BY_3.get(upper.slice(0, 3)) ??
    REG_BY_2.get(upper.slice(0, 2)) ??
    REG_BY_1.get(upper[0]) ??
    null
  );
}

// ── Category Conversion ────────────────────────────────────────────────
//
// Converts readsb category string ("A0"–"D7") to the numeric encoding
// used by OpenSky (DO-260B spec). A-set: A0→0, A1→2(light)…A7→8(rotorcraft).
// B-set: B0→0, B1→9(glider)…B7→15(space). C-set: surface vehicles. D: reserved.

function readsbCategoryToNumber(cat: unknown): number | null {
  if (typeof cat !== "string" || cat.length !== 2) return null;

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

/**
 * Maps readsb `type` field to unified PositionSource.
 *
 * readsb `type` values include adsb_icao, adsr_icao, mlat,
 * tisb_icao, adsc, mode_s, and other provider-specific variants.
 */
function readsbTypeToPositionSource(
  type: unknown,
): PositionSource {
  if (typeof type !== "string" || !type) return null;
  const normalized = type.toLowerCase();

  if (normalized.startsWith("adsb") || normalized.startsWith("adsr")) {
    return "adsb";
  }
  if (normalized === "mlat") return "mlat";
  if (normalized.startsWith("tisb")) return "tisb";
  if (normalized === "adsc") return "adsc";

  return "other";
}

// ── Altitude Parser ────────────────────────────────────────────────────

function parseAltBaro(value: unknown): {
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

function isValidIcaoHex(hex: unknown): hex is string {
  // Filter out '~'-prefixed non-ICAO addresses and invalid formats
  return (
    typeof hex === "string" && !hex.startsWith("~") && ICAO_HEX_RE.test(hex)
  );
}

// ── Optional Finite Helper ─────────────────────────────────────────────

/** Returns the value if it's a finite number, otherwise null. */
function optionalFinite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function optionalTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

// ── Single Aircraft Parser ─────────────────────────────────────────────

function parseRawAircraft(
  raw: RawAircraft,
  options?: ParseOptions,
): FlightState | null {
  // Reject non-ICAO addresses (TIS-B, etc.)
  if (!isValidIcaoHex(raw.hex)) return null;

  // Require a valid position within geographic bounds
  if (typeof raw.lat !== "number" || typeof raw.lon !== "number") return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  if (raw.lat < -90 || raw.lat > 90 || raw.lon < -180 || raw.lon > 180)
    return null;

  // Filter stale positions (>60s old)
  if (
    raw.seen_pos !== undefined &&
    (typeof raw.seen_pos !== "number" ||
      !Number.isFinite(raw.seen_pos) ||
      raw.seen_pos < 0 ||
      raw.seen_pos > MAX_POSITION_AGE_S)
  ) {
    return null;
  }

  const { altitude, onGround } = parseAltBaro(raw.alt_baro);
  const responseTime =
    normalizeFlightTimestamp(options?.responseTime) ?? Date.now();
  const relayFixTime = normalizeFlightTimestamp(raw.fix_time);

  return {
    icao24: raw.hex.toLowerCase(),
    ...(typeof raw.track_id === "string" && raw.track_id.length <= 128
      ? { trackId: raw.track_id }
      : {}),
    altitudeReference: onGround
      ? "ground"
      : altitude !== null
        ? "barometric"
        : typeof raw.alt_geom === "number" && Number.isFinite(raw.alt_geom)
          ? "geometric"
          : "unknown",
    callsign: optionalTrimmedString(raw.flight),
    registrationCountry: countryFromRegistration(raw.r),
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
    geomRate:
      typeof raw.geom_rate === "number" && Number.isFinite(raw.geom_rate)
        ? raw.geom_rate * FTPM_TO_MS
        : null,
    geoAltitude:
      typeof raw.alt_geom === "number" && Number.isFinite(raw.alt_geom)
        ? raw.alt_geom * FT_TO_M
        : null,
    squawk: optionalTrimmedString(raw.squawk),
    spiFlag: raw.spi === 1,
    positionSource: readsbTypeToPositionSource(raw.type),
    category: readsbCategoryToNumber(raw.category),
    typeCode: optionalTrimmedString(raw.t),
    registration: optionalTrimmedString(raw.r),
    provenance: createFlightProvenance({
      positionProvider: options?.positionProvider ?? "unknown",
      responseTime,
      observationTime:
        relayFixTime ??
        (typeof raw.seen_pos === "number"
          ? responseTime - raw.seen_pos * 1000
          : null),
      positionAgeSeconds: raw.seen_pos,
    }),

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
    navModes:
      Array.isArray(raw.nav_modes) &&
      raw.nav_modes.every((mode) => typeof mode === "string") &&
      raw.nav_modes.length > 0
        ? raw.nav_modes
        : null,

    // ── Atmospheric ────────────────────────────────────────────────
    windDirection: optionalFinite(raw.wd),
    windSpeed: optionalFinite(raw.ws),
    oat: optionalFinite(raw.oat),

    // ── Classification ─────────────────────────────────────────────
    dbFlags: optionalFinite(raw.dbFlags),
    emergencyStatus:
      typeof raw.emergency === "string" && raw.emergency !== "none"
        ? raw.emergency
        : null,
    typeDescription: optionalTrimmedString(raw.desc),

    // ── Debug / Raw Data (readsb only) ───────────────────────────────
    debugData: {
      nic: optionalFinite(raw.nic),
      nacP: optionalFinite(raw.nac_p),
      nacV: optionalFinite(raw.nac_v),
      sil: optionalFinite(raw.sil),
      version: optionalFinite(raw.version),
      alert: optionalFinite(raw.alert),
      messages:
        typeof raw.messages === "number" && Number.isFinite(raw.messages)
          ? raw.messages
          : null,
      seen:
        typeof raw.seen === "number" && Number.isFinite(raw.seen)
          ? raw.seen
          : null,
      rssi:
        typeof raw.rssi === "number" && Number.isFinite(raw.rssi)
          ? raw.rssi
          : null,
    },
  };
}

// ── Batch Parser ───────────────────────────────────────────────────────

export interface ParseOptions {
  /** Include aircraft on the ground. Default: false. */
  includeGround?: boolean;
  /** Require barometric altitude. Default: true. */
  requireBaroAltitude?: boolean;
  /** Provider that supplied this response. */
  positionProvider?: string;
  /** Provider response time in Unix seconds or milliseconds. */
  responseTime?: number;
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
    const state = parseRawAircraft(raw, options);
    if (!state) continue;

    // Filter ground aircraft unless specifically requested
    if (!includeGround && state.onGround) continue;

    // Filter aircraft without barometric altitude if required
    if (requireBaroAltitude && state.baroAltitude === null) continue;

    results.push(state);
  }

  return results;
}

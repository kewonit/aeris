/** @see https://openskynetwork.github.io/opensky-api/rest.html */

import { ICAO24_REGEX } from "./flight-api-types";
import { clamp } from "./utils";
export { ICAO24_REGEX, clamp };

// ── API Constants ──────────────────────────────────────────────────────

export const OPENSKY_API = "https://opensky-network.org/api";
export const FETCH_TIMEOUT_MS = 15_000;
/** Callsign lookup scans global /states/all (4 credits); cache longer to reduce spikes. */
export const CALLSIGN_CACHE_TTL_MS = 2 * 60_000;
export const CALLSIGN_CACHE_MAX_ENTRIES = 200;
/** Bbox is ±radius → side = 2×2.49 = 4.98° → area ≈ 24.8 sq-deg < 25 (1 credit tier). */
export const MAX_1_CREDIT_RADIUS_DEG = 2.49;
/** Delay between sequential segment fetches to avoid burst rate limits. */
export const SEGMENT_DELAY_MS = 200;

// ── Exported Types ─────────────────────────────────────────────────────

/**
 * Unified position source across all upstream providers.
 *
 * OpenSky encodes this as numbers (0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM).
 * readsb/airplanes.live encode this as the `type` string
 * (adsb_icao, mlat, tisb_icao, etc.).
 */
export type PositionSource =
  | "adsb"
  | "asterix"
  | "mlat"
  | "flarm"
  | "tisb"
  | "adsc"
  | "other"
  | null;

export type FlightProvenance = {
  /** Provider response time as Unix milliseconds */
  responseTime: number;
  /** Time of the position observation as Unix milliseconds */
  observationTime: number | null;
  /** Age of the position when the provider built its response */
  positionAgeSeconds: number | null;
  /** All sources that supplied fields in this state */
  contributingSources: string[];
  /** Provider that supplied the selected position and motion group */
  positionProvider: string;
};

export type FlightState = {
  icao24: string;
  /** Relay identity scoped by provider epoch, address type, and session. */
  trackId?: string;
  /** Relay source epoch used to break tracks across whole-feed recovery. */
  sourceEpoch?: string;
  /** Altitude datum selected for this normalized observation. */
  altitudeReference?: "barometric" | "geometric" | "ground" | "unknown";
  /** True when the relay requires a visual track break before this fix. */
  discontinuity?: boolean;
  callsign: string | null;
  registrationCountry: string | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  /** Geometric (GNSS) vertical rate in m/s — readsb only */
  geomRate?: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  spiFlag: boolean;
  positionSource: PositionSource;
  category: number | null;
  /** ICAO type designator (e.g. "A320", "B738") - available from readsb */
  typeCode?: string | null;
  /** Aircraft registration (e.g. "N12345", "G-KELS") - available from readsb */
  registration?: string | null;
  /** Two-letter registration country code from the local registry */
  registrationCountryCode?: string | null;
  /** Registration country flag from the local registry */
  registrationCountryFlag?: string | null;
  /** Aircraft model from the local registry */
  model?: string | null;
  /** Aircraft manufacturer from the local registry */
  manufacturer?: string | null;
  /** Source and observation timing for this state */
  provenance: FlightProvenance;

  // ── Avionics Data (readsb only, omitted by OpenSky) ──────────────

  /** Indicated Airspeed in knots */
  ias?: number | null;
  /** True Airspeed in knots */
  tas?: number | null;
  /** Mach number (e.g. 0.82) */
  mach?: number | null;
  /** Roll angle in degrees; negative = left bank */
  roll?: number | null;
  /** Rate of change of track, degrees per second */
  trackRate?: number | null;
  /** Magnetic heading in degrees (0–359) */
  magHeading?: number | null;

  // ── Navigation Intent ────────────────────────────────────────────

  /** Selected altitude on MCP/FCU in feet */
  navAltitudeMcp?: number | null;
  /** FMS-selected altitude in feet */
  navAltitudeFms?: number | null;
  /** Selected heading in degrees (typically magnetic) */
  navHeading?: number | null;
  /** Altimeter setting (QNH) in hPa */
  navQnh?: number | null;
  /** Active autopilot modes, e.g. ["autopilot","vnav","lnav","althold","approach","tcas"] */
  navModes?: string[] | null;

  // ── Atmospheric Data ─────────────────────────────────────────────

  /** Wind direction in degrees (where wind is coming FROM); derived from GS/TAS/track/heading */
  windDirection?: number | null;
  /** Wind speed in knots; derived from GS/TAS/track/heading */
  windSpeed?: number | null;
  /** Outside (static) air temperature in °C; inhibited for Mach < 0.395 */
  oat?: number | null;

  // ── Classification ───────────────────────────────────────────────

  /** Database flags bitmask: military=1, interesting=2, PIA=4, LADD=8 */
  dbFlags?: number | null;
  /** ADS-B emergency/priority status: "none"|"general"|"lifeguard"|"minfuel"|"nordo"|"unlawful"|"downed" */
  emergencyStatus?: string | null;
  /** Aircraft type description (e.g. "AIRBUS A-320") - Airplanes.live only */
  typeDescription?: string | null;

  // ── Debug / Raw Data (readsb only, hidden by default) ──────────────

  /** Integrity, accuracy, and receiver metadata for advanced users */
  debugData?: FlightDebugData | null;
};

export type FlightDebugData = {
  /** Navigation Integrity Category (0–11) */
  nic: number | null;
  /** Navigation Accuracy for Position (0–11) */
  nacP: number | null;
  /** Navigation Accuracy for Velocity (0–4) */
  nacV: number | null;
  /** Source Integrity Level (0–3) */
  sil: number | null;
  /** ADS-B Version (0, 1, 2) */
  version: number | null;
  /** Flight status alert bit (0/1) */
  alert: number | null;
  /** Total Mode S messages received */
  messages: number | null;
  /** Seconds since last message */
  seen: number | null;
  /** Signal strength in dBFS (negative) */
  rssi: number | null;
};

export type FetchResult = {
  flights: FlightState[];
  rateLimited: boolean;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
};

export type TrackWaypoint = {
  time: number;
  latitude: number | null;
  longitude: number | null;
  baroAltitude: number | null;
  trueTrack: number | null;
  onGround: boolean;
};

export type FlightTrack = {
  icao24: string;
  startTime: number;
  endTime: number;
  callsign: string | null;
  path: TrackWaypoint[];
};

export type TrackFetchResult = {
  track: FlightTrack | null;
  rateLimited: boolean;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
};

// ── Internal Types (used across sub-modules) ───────────────────────────

export type OpenSkyResponse = {
  time: number;
  states: (string | number | boolean | null)[][] | null;
};

export type ParseStateOptions = {
  includeGround?: boolean;
  requireBaroAltitude?: boolean;
  positionProvider?: string;
  responseTime?: number;
};

export type RateLimitInfo = {
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
};

export type CallsignLookupResult = {
  flight: FlightState | null;
  creditsRemaining: number | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
};

export type OpenSkyTrackResponse = {
  icao24?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  callsign?: unknown;
  // Defensive: accept a misspelled field name if present.
  calllsign?: unknown;
  path?: unknown;
};

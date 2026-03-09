/** @see https://openskynetwork.github.io/opensky-api/rest.html */

// ── API Constants ──────────────────────────────────────────────────────

export const OPENSKY_API = "https://opensky-network.org/api";
export const FETCH_TIMEOUT_MS = 15_000;
export const ICAO24_REGEX = /^[0-9a-f]{6}$/i;
/** Callsign lookup scans global /states/all (4 credits); cache longer to reduce spikes. */
export const CALLSIGN_CACHE_TTL_MS = 2 * 60_000;
export const CALLSIGN_CACHE_MAX_ENTRIES = 200;
/** Keep bbox queries inside OpenSky's 0–25 sq-deg (1 credit) tier. */
export const MAX_1_CREDIT_RADIUS_DEG = 2.49;
/** Delay between sequential segment fetches to avoid burst rate limits. */
export const SEGMENT_DELAY_MS = 200;

// ── Exported Types ─────────────────────────────────────────────────────

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

// ── Shared Utilities ───────────────────────────────────────────────────

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

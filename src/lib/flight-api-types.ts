// ── readsb API Types ─────────────────────────────────────────────────
//
// Shared format used by both Airplanes.live and adsb.lol.
// Verified against official docs:
//   https://airplanes.live/rest-api-adsb-data-field-descriptions/
//   https://api.adsb.lol/api/openapi.json
//   https://github.com/wiedehopf/readsb/blob/dev/README-json.md
// ────────────────────────────────────────────────────────────────────────

// ── Provider Configuration ─────────────────────────────────────────────

export interface FlightApiProvider {
  name: string;
  /** No trailing slash, e.g. "https://api.airplanes.live/v2" */
  baseUrl: string;
  rateMs: number;
}

export const PROVIDER_AIRPLANES_LIVE: FlightApiProvider = {
  name: "Airplanes.live",
  baseUrl: "https://api.airplanes.live/v2",
  rateMs: 1_000, // Documented: 1 req/s
};

export const PROVIDER_ADSB_LOL: FlightApiProvider = {
  name: "adsb.lol",
  baseUrl: "https://api.adsb.lol/v2",
  rateMs: 500, // Self-imposed: 2 req/s
};

export const PROVIDERS: readonly FlightApiProvider[] = [
  PROVIDER_AIRPLANES_LIVE,
  PROVIDER_ADSB_LOL,
] as const;

// ── API Constants ──────────────────────────────────────────────────────

export const READSB_FETCH_TIMEOUT_MS = 10_000;
export const ICAO24_REGEX = /^[0-9a-f]{6}$/i;
export const MAX_RADIUS_NM = 250;

/**
 * From the docs: "when the regular lat and lon are older than 60 seconds
 * they are no longer considered valid."
 */
export const MAX_POSITION_AGE_S = 60;

export const NM_PER_DEG_LAT = 60;

// ── Raw API Response Types ─────────────────────────────────────────────

/**
 * A single aircraft entry from the readsb JSON response.
 * Keys are omitted by the API if data is not available.
 * @see https://airplanes.live/rest-api-adsb-data-field-descriptions/
 */
export interface RawAircraft {
  /** 24-bit ICAO hex address (6 chars). Starts with '~' for non-ICAO. */
  hex: string;
  /** Type of underlying message source (adsb_icao, mlat, tisb_icao, etc.) */
  type: string;
  /** Callsign, 8-char padded with trailing spaces. */
  flight?: string;
  /** Aircraft registration from database. */
  r?: string;
  /** Aircraft ICAO type code from database (e.g. "A320", "B738"). */
  t?: string;
  /** Aircraft type description. Airplanes.live only. */
  desc?: string;
  /** Database flags bitmask: military=1, interesting=2, PIA=4, LADD=8. */
  dbFlags?: number;

  // ── Position ───────────────────────────────────────────────────────
  lat?: number;
  lon?: number;
  seen_pos?: number;

  // ── Altitude ───────────────────────────────────────────────────────
  /** In feet, or "ground" when on ground. */
  alt_baro?: number | "ground";
  /** Geometric (GNSS) altitude in feet. */
  alt_geom?: number;

  // ── Speed & Track ──────────────────────────────────────────────────
  gs?: number;
  /** Degrees (0–359). */
  track?: number;
  baro_rate?: number;
  geom_rate?: number;

  // ── ADS-B Category ─────────────────────────────────────────────────
  /** "A0"–"A7", "B0"–"B7", "C1"–"C3", "D0"–"D7". */
  category?: string;

  // ── Transponder ────────────────────────────────────────────────────
  /** 4 octal digits. */
  squawk?: string;
  /** "none", "general", "lifeguard", "minfuel", "nordo", "unlawful", "downed". */
  emergency?: string;
  spi?: number;
  alert?: number;

  // ── Additional speed data ──────────────────────────────────────────
  ias?: number;
  tas?: number;
  mach?: number;

  // ── Heading ────────────────────────────────────────────────────────
  mag_heading?: number;
  true_heading?: number;
  roll?: number;
  track_rate?: number;

  // ── Navigation ─────────────────────────────────────────────────────
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  nav_altitude_fms?: number;
  nav_heading?: number;
  nav_modes?: string[];

  // ── Wind & Temperature ─────────────────────────────────────────────
  wd?: number;
  ws?: number;
  /** Outer air temperature (°C). */
  oat?: number;
  /** Total air temperature (°C). */
  tat?: number;

  // ── Integrity / Accuracy ───────────────────────────────────────────
  nic?: number;
  rc?: number;
  nic_baro?: number;
  nac_p?: number;
  nac_v?: number;
  sil?: number;
  sil_type?: string;
  gva?: number;
  sda?: number;
  version?: number;

  // ── Message stats ──────────────────────────────────────────────────
  messages: number;
  seen: number;
  /** dBFS (always negative). */
  rssi: number;
  mlat: string[];
  tisb: string[];

  // ── Fallback position (stale) ──────────────────────────────────────
  lastPosition?: {
    lat: number;
    lon: number;
    nic: number;
    rc: number;
    seen_pos: number;
  };

  // ── Rough estimated position ───────────────────────────────────────
  rr_lat?: number;
  rr_lon?: number;
}

/**
 * Top-level response from any readsb endpoint.
 * @see https://api.adsb.lol/api/openapi.json — V2Response_Model
 */
export interface ReadsbApiResponse {
  ac: RawAircraft[];
  msg: string;
  now: number;
  total: number;
  ctime: number;
  ptime: number;
}

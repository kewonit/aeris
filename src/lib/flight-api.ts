/**
 * Flight API client — barrel re-export.
 *
 * 3-tier fallback chain:
 *   Tier 1: airplanes.live (direct, CORS OK)
 *   Tier 2: adsb.lol       (via proxy, no CORS)
 *   Tier 3: OpenSky        (direct, CORS OK, limited credits)
 *
 * Dev override: add ?provider=airplanes|adsb|opensky to the URL.
 *
 * @see https://airplanes.live/api-guide/
 * @see https://api.adsb.lol/docs
 * @see https://openskynetwork.github.io/opensky-api/rest.html
 */

// ── Types ──────────────────────────────────────────────────────────────
export type { RawAircraft, ReadsbApiResponse } from "./flight-api-types";

export type { FlightApiFetchResult, ProviderName } from "./flight-api-client";

// ── Constants ──────────────────────────────────────────────────────────
export { MAX_RADIUS_NM, NM_PER_DEG_LAT } from "./flight-api-types";

// ── Client ─────────────────────────────────────────────────────────────
export {
  fetchFlightsByPoint,
  fetchFlightByHex,
  fetchFlightByCallsign,
  getProviderOverride,
} from "./flight-api-client";

// ── Parser ─────────────────────────────────────────────────────────────
export { parseAircraftList } from "./flight-api-parsing";

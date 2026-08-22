/**
 * Flight API client - barrel re-export.
 *
 * Default 3-tier fallback chain:
 *   Tier 1: adsb.lol       (server proxy)
 *   Tier 2: airplanes.live (server proxy, best effort)
 *   Tier 3: OpenSky        (direct, limited credits)
 *
 * Override: add ?provider=airplanes|adsb|opensky to the URL.
 *
 * @see https://api.airplanes.live/openapi.json
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
  getCircuitState,
  resetAllCircuits,
} from "./flight-api-client";

export type { CircuitState } from "./flight-api-client";

// ── Parser ─────────────────────────────────────────────────────────────
export { parseAircraftList } from "./flight-api-parsing";

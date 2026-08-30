/**
 * Flight API client - barrel re-export.
 *
 * Default 4-tier fallback chain:
 *   Tier 1: adsb.lol       (server proxy)
 *   Tier 2: adsb.fi        (server proxy, public fallback)
 *   Tier 3: airplanes.live (server proxy, best effort)
 *   Tier 4: OpenSky        (direct, limited credits)
 *
 * Override: add ?provider=airplanes|adsb|adsbfi|opensky to the URL.
 *
 * @see https://api.airplanes.live/openapi.json
 * @see https://api.adsb.lol/docs
 * @see https://github.com/adsbfi/opendata
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
  fetchSelectedAircraftFromAdsbLol,
  getProviderOverride,
  setProviderOverride,
  PROVIDER_CHANGE_EVENT,
  getCircuitState,
  resetAllCircuits,
  isRelayClientConfigured,
} from "./flight-api-client";

export type { CircuitState } from "./flight-api-client";

// ── Parser ─────────────────────────────────────────────────────────────
export { parseAircraftList } from "./flight-api-parsing";

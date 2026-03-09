/**
 * OpenSky Network API client — barrel re-export.
 *
 * All implementation has been split into focused sub-modules.
 * This file re-exports everything for backward compatibility.
 *
 * @see https://openskynetwork.github.io/opensky-api/rest.html
 */

// ── Types ──────────────────────────────────────────────────────────────
export type {
  FlightState,
  FetchResult,
  TrackWaypoint,
  FlightTrack,
  TrackFetchResult,
} from "./opensky-types";

// ── Flight fetchers ────────────────────────────────────────────────────
export {
  fetchFlightsByBbox,
  bboxFromCenter,
  fetchFlightByIcao24,
  fetchFlightByCallsign,
  fetchFlightsByRoute,
} from "./opensky-flights";

// ── Track fetcher ──────────────────────────────────────────────────────
export { fetchTrackByIcao24 } from "./opensky-tracks";

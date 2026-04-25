// ── Route Detection (Client-Side) ───────────────────────────────────
//
// Provides observed departure detection without any external API calls:
//
// Tracks ground→airborne transitions and snapshots the nearest airport as the
// departure airport. Route destinations come from route databases only, never
// from heading/altitude prediction.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "./opensky-types";
import type { FlightTrack } from "./opensky-types";
import type { Airport } from "./airports";
import { findNearestAirport } from "./airports";
import type { RouteAirport } from "./route-lookup";

// ── Types ──────────────────────────────────────────────────────────────

export type DepartureInfo = {
  airport: RouteAirport;
  /** Unix timestamp (ms) when departure was detected */
  detectedAt: number;
  /** Position where the aircraft was first seen airborne */
  lat: number;
  lng: number;
};

// ── Constants ──────────────────────────────────────────────────────────

/** Maximum distance from takeoff point to match a departure airport (km) */
const DEPARTURE_MATCH_RADIUS_KM = 15;

/** Minimum time between departure detections for the same aircraft (ms) */
const DEPARTURE_DEBOUNCE_MS = 5 * 60_000;

/** Maximum entries in departure tracking map */
const MAX_DEPARTURE_ENTRIES = 500;

// ── Departure Tracking ────────────────────────────────────────────────

type DepartureTrackingEntry = {
  /** Was the aircraft on ground in the previous poll? */
  wasOnGround: boolean;
  /** Detected departure info (null if not yet departed) */
  departure: DepartureInfo | null;
  /** Last departure detection timestamp (for debouncing) */
  lastDepartureAt: number;
};

const departureTracking = new Map<string, DepartureTrackingEntry>();

function airportToRouteAirport(airport: Airport): RouteAirport {
  return {
    iata: airport.iata,
    icao: "",
    name: airport.name,
    municipality: airport.city,
    countryIso: airport.country,
    latitude: airport.lat,
    longitude: airport.lng,
  };
}

/**
 * Process a batch of flights to detect departures.
 * Call this on every poll cycle with the current visible flights.
 *
 * Updates internal state and returns departures detected this cycle.
 */
export function processDepartures(
  flights: FlightState[],
): Map<string, DepartureInfo> {
  const now = Date.now();
  const newDepartures = new Map<string, DepartureInfo>();

  // Track which ICAOs are in the current batch
  const currentIcaos = new Set<string>();

  for (const flight of flights) {
    const { icao24 } = flight;
    currentIcaos.add(icao24);

    let entry = departureTracking.get(icao24);

    if (!entry) {
      // First time seeing this aircraft
      entry = {
        wasOnGround: flight.onGround,
        departure: null,
        lastDepartureAt: 0,
      };
      departureTracking.set(icao24, entry);
      continue;
    }

    // Detect ground→airborne transition
    if (
      entry.wasOnGround &&
      !flight.onGround &&
      flight.latitude != null &&
      flight.longitude != null &&
      now - entry.lastDepartureAt > DEPARTURE_DEBOUNCE_MS
    ) {
      const nearestAirport = findNearestAirport(
        flight.latitude,
        flight.longitude,
        DEPARTURE_MATCH_RADIUS_KM,
      );

      if (nearestAirport) {
        const departure: DepartureInfo = {
          airport: airportToRouteAirport(nearestAirport),
          detectedAt: now,
          lat: flight.latitude,
          lng: flight.longitude,
        };
        entry.departure = departure;
        entry.lastDepartureAt = now;
        newDepartures.set(icao24, departure);
      }
    }

    entry.wasOnGround = flight.onGround;
  }

  // Evict stale entries for aircraft no longer visible
  if (departureTracking.size > MAX_DEPARTURE_ENTRIES) {
    const entries = Array.from(departureTracking.entries());
    // Sort by last seen: keep entries that are in the current batch
    entries.sort((a, b) => {
      const aActive = currentIcaos.has(a[0]) ? 1 : 0;
      const bActive = currentIcaos.has(b[0]) ? 1 : 0;
      return bActive - aActive;
    });
    departureTracking.clear();
    for (const [k, v] of entries.slice(0, MAX_DEPARTURE_ENTRIES)) {
      departureTracking.set(k, v);
    }
  }

  return newDepartures;
}

/**
 * Get the stored departure for a specific aircraft.
 */
export function getDeparture(icao24: string): DepartureInfo | null {
  return departureTracking.get(icao24)?.departure ?? null;
}

// ── Trace-Based Departure Detection ────────────────────────────────────

/** Max altitude (meters) at the first waypoint to consider it a departure point.
 *  After trace pre-processing, the first waypoint is typically at or near the runway.
 *  1500m (~5,000ft) is generous enough to handle traces that start shortly after
 *  takeoff while still excluding mid-cruise trace fragments. */
const TRACE_DEPARTURE_MAX_ALT_M = 1500;

/** Below this altitude, no extra climb-validation is needed (clearly at airport). */
const TRACE_DEPARTURE_CERTAIN_ALT_M = 500;

/**
 * Determine the departure airport from a flight trace.
 *
 * Looks at the first waypoint of the trace:
 *   - On ground → match nearest airport (definite departure)
 *   - Below 500m → match nearest airport (very likely departure)
 *   - 500–1500m → only match if subsequent waypoints show climbing
 *     (confirms this is a real climb-out, not a random mid-flight start)
 *   - Above 1500m → not a departure
 *
 * This works for any flight with trace data, regardless of whether the
 * callsign exists in any route database. Zero API cost — uses data
 * already fetched by the trace endpoint.
 */
export function departureFromTrace(
  track: FlightTrack | null,
): RouteAirport | null {
  if (!track || track.path.length === 0) return null;

  const first = track.path[0];
  if (first.latitude == null || first.longitude == null) return null;

  const isOnGround = first.onGround;
  const firstAlt = first.baroAltitude;

  // Above 1500m → definitely not at a departure airport
  if (!isOnGround && (firstAlt == null || firstAlt > TRACE_DEPARTURE_MAX_ALT_M))
    return null;

  // Between 500m and 1500m: require climb confirmation from subsequent waypoints
  // to distinguish real departures from mid-flight trace starts
  if (
    !isOnGround &&
    firstAlt != null &&
    firstAlt > TRACE_DEPARTURE_CERTAIN_ALT_M
  ) {
    const lookAhead = track.path.slice(1, Math.min(6, track.path.length));
    const hasClimb = lookAhead.some(
      (wp) =>
        wp.baroAltitude != null &&
        firstAlt != null &&
        wp.baroAltitude > firstAlt + 200,
    );
    if (!hasClimb) return null;
  }

  const airport = findNearestAirport(
    first.latitude,
    first.longitude,
    DEPARTURE_MATCH_RADIUS_KM,
  );

  if (!airport) return null;

  return airportToRouteAirport(airport);
}

/**
 * Clear all departure tracking data.
 * Call when switching cities or resetting state.
 */
export function clearDepartures(): void {
  departureTracking.clear();
}

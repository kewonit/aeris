// ── Route Detection (Client-Side) ───────────────────────────────────
//
// Provides two capabilities without any external API calls:
//
// 1. **Departure detection**: Tracks ground→airborne transitions
//    and snapshots the nearest airport as the departure airport.
//
// 2. **Destination estimation**: Uses heading + altitude + vertical rate
//    to estimate the most likely destination airport with a confidence
//    score (HIGH / MEDIUM / LOW).
//
// Both work entirely from live ADS-B data already flowing through
// the polling pipeline. Zero network cost.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "./opensky-types";
import type { FlightTrack } from "./opensky-types";
import type { Airport } from "./airports";
import { findNearestAirport, getMajorAirports } from "./airports";
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

export type DestinationEstimate = {
  airport: RouteAirport;
  confidence: "high" | "medium" | "low";
  /** Distance to the estimated destination in km */
  distanceKm: number;
};

// ── Constants ──────────────────────────────────────────────────────────

/** Maximum distance from takeoff point to match a departure airport (km) */
const DEPARTURE_MATCH_RADIUS_KM = 15;

/** Minimum time between departure detections for the same aircraft (ms) */
const DEPARTURE_DEBOUNCE_MS = 5 * 60_000;

/** Maximum entries in departure tracking map */
const MAX_DEPARTURE_ENTRIES = 500;

// ── Destination estimation constants ───────────────────────────────────

/** Half-angle of the forward search cone (degrees) */
const CONE_HALF_ANGLE_WIDE = 25;
const CONE_HALF_ANGLE_APPROACH = 15;

/** Max distance to search for destination airports (km) */
const MAX_SEARCH_DISTANCE_KM = 12_000;

/** Threshold: aircraft is descending (m/s, negative means descending) */
const DESCENT_RATE_THRESHOLD = -2.0;

/** Altitude below which we consider aircraft in approach phase (meters) */
const APPROACH_ALTITUDE_M = 6_000;

/** Distance within which an approaching aircraft likely targets this airport (km) */
const APPROACH_DISTANCE_KM = 120;

/** Sustained turn rate that suggests holding pattern (degrees/second) */
const HOLDING_TURN_RATE = 2.0;

/** Earth radius in km */
const EARTH_RADIUS_KM = 6371;

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

// ── Destination Estimation ─────────────────────────────────────────────

/**
 * Compute the great-circle bearing from point 1 to point 2 in degrees [0, 360).
 */
function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = Math.PI / 180;
  const la1 = lat1 * toRad;
  const la2 = lat2 * toRad;
  const dLng = (lng2 - lng1) * toRad;

  const y = Math.sin(dLng) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);

  const brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
}

/**
 * Compute the great-circle distance between two points in km.
 */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Angular difference between two bearings, accounting for wrap-around.
 * Returns value in [0, 180].
 */
function angularDifference(a: number, b: number): number {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Estimate the most likely destination airport for a flight.
 *
 * Strategy:
 * - Cast a forward cone from the aircraft's current position along its heading
 * - Score candidate airports by:
 *   - Proximity (closer = better)
 *   - Airport significance (3-letter IATA code = major airport)
 *   - Alignment with heading (center of cone = better)
 * - Adjust confidence based on flight phase:
 *   - Descending + low altitude + close airport = HIGH
 *   - Cruising + heading matches major airport = MEDIUM
 *   - Otherwise = LOW
 *
 * Returns null if no reasonable destination can be estimated
 * (e.g., no callsign, no heading, holding pattern, GA aircraft
 * with no identifiable destination).
 */
export function estimateDestination(
  flight: FlightState,
  departureIata?: string,
): DestinationEstimate | null {
  // Need position and heading
  if (
    flight.latitude == null ||
    flight.longitude == null ||
    flight.trueTrack == null ||
    !Number.isFinite(flight.trueTrack)
  ) {
    return null;
  }

  // Detect holding pattern — suppress estimation if aircraft is circling
  if (
    flight.trackRate != null &&
    Math.abs(flight.trackRate) > HOLDING_TURN_RATE
  ) {
    return null;
  }

  const lat = flight.latitude;
  const lng = flight.longitude;
  const heading = flight.trueTrack;
  const altitudeM = flight.baroAltitude ?? 0;
  const verticalRate = flight.verticalRate ?? 0;
  const isDescending = verticalRate < DESCENT_RATE_THRESHOLD;
  const isApproaching = isDescending && altitudeM < APPROACH_ALTITUDE_M;

  // Choose cone parameters based on flight phase
  const coneHalfAngle = isApproaching
    ? CONE_HALF_ANGLE_APPROACH
    : CONE_HALF_ANGLE_WIDE;
  const maxDistance = isApproaching
    ? APPROACH_DISTANCE_KM
    : MAX_SEARCH_DISTANCE_KM;

  // Search through major airports only (ones with IATA codes)
  const airports = getMajorAirports();

  type Candidate = {
    airport: Airport;
    distanceKm: number;
    bearingDeg: number;
    angularOffset: number;
    score: number;
  };

  const candidates: Candidate[] = [];

  for (const airport of airports) {
    // Skip the departure airport
    if (departureIata && airport.iata === departureIata) continue;

    const dist = haversineKm(lat, lng, airport.lat, airport.lng);
    if (dist > maxDistance) continue;

    // Must be at least 30km away (don't estimate departure airport as destination)
    if (dist < 30) continue;

    const brng = bearing(lat, lng, airport.lat, airport.lng);
    const offset = angularDifference(heading, brng);

    // Must be within the search cone
    if (offset > coneHalfAngle) continue;

    // Score: closer + more aligned + IATA code bonus
    // Distance score: exponential decay
    const distScore = Math.exp(-dist / 3000);
    // Alignment score: cosine-like, 1.0 at center, 0.0 at edge
    const alignScore = Math.cos((offset / coneHalfAngle) * (Math.PI / 2));
    // Combine
    const score = distScore * 0.6 + alignScore * 0.4;

    candidates.push({
      airport,
      distanceKm: dist,
      bearingDeg: brng,
      angularOffset: offset,
      score,
    });
  }

  if (candidates.length === 0) return null;

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];

  // Determine confidence
  let confidence: "high" | "medium" | "low";

  if (isApproaching && best.distanceKm < APPROACH_DISTANCE_KM) {
    // Descending + low altitude + within approach distance
    confidence = "high";
  } else if (
    isDescending &&
    altitudeM < 10_000 &&
    best.distanceKm < 200 &&
    best.angularOffset < 10
  ) {
    // Clearly approaching — moderate altitude, close, well-aligned
    confidence = "high";
  } else if (best.distanceKm < 1500 && best.angularOffset < 15) {
    // Reasonably close + well-aligned
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    airport: airportToRouteAirport(best.airport),
    confidence,
    distanceKm: Math.round(best.distanceKm),
  };
}

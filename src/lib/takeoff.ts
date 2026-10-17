import { findNearestAirport, type Airport } from "./airports";
import type { FlightTrack, TrackWaypoint } from "./opensky";

const FEET = 0.3048;
/** A point this close to an airport can be on its runway or climbing out. */
const AIRPORT_RADIUS_KM = 8;
/**
 * Within this of the airport's elevation, the aircraft is taking off or
 * landing there. OpenSky rounds track heights down to the thousand feet,
 * so a point just after lift-off can read up to a thousand feet low.
 */
const NEAR_GROUND_METERS = 1_500 * FEET;
/**
 * Climbing this far above the airport means it took off. A go-around climbs
 * to a few thousand feet at most, so it is not mistaken for one.
 */
const CLIMB_OUT_METERS = 6_000 * FEET;
/** The take-off must be watched: the first airborne point comes this soon. */
const MAX_TAKEOFF_GAP_S = 10 * 60;
/**
 * Over a longer gap the aircraft could have landed somewhere unseen,
 * unless it stayed this high on both sides of it.
 */
const MAX_UNWATCHED_GAP_S = 30 * 60;
const UNWATCHED_GAP_FLOOR_METERS = 10_000 * FEET;
/** No flight runs longer than this. */
const MAX_FLIGHT_S = 20 * 60 * 60;

/** Where and when the aircraft took off on the flight it is flying now. */
export type Takeoff = {
  latitude: number;
  longitude: number;
  /** Seconds since the epoch. */
  time: number;
  /** The listed airport it took off from, when it took off from one. */
  airport: Airport | null;
};

type Point = TrackWaypoint & { latitude: number; longitude: number };

/**
 * Whether an airport takes airliners rather than seaplanes or helicopters,
 * which have local codes with digits or say so in their names.
 */
function isRunwayAirport(airport: Airport): boolean {
  return (
    /^[A-Z]{4}$/.test(airport.icao) && !/seaplane|heli/i.test(airport.name)
  );
}

/**
 * The airport a point is at. Near a large airport a seaplane base or
 * heliport can sit closer to the end of the runway than the airport's own
 * reference point, so a runway airport in reach is preferred.
 */
function airportAt(point: Point): Airport | null {
  const { latitude, longitude } = point;
  return (
    findNearestAirport(latitude, longitude, AIRPORT_RADIUS_KM, {
      accept: isRunwayAirport,
    }) ?? findNearestAirport(latitude, longitude, AIRPORT_RADIUS_KM)
  );
}

/** The highest airports sit below this, so a point above it is airborne. */
const HIGHEST_AIRPORT_METERS = 15_000 * FEET;

type Ground = { airport: Airport | null; meters: number };

/** The ground a point is on or just above, if it is taking off or landing. */
function groundAt(point: Point): Ground | null {
  const airport =
    point.onGround ||
    (point.baroAltitude !== null &&
      point.baroAltitude < HIGHEST_AIRPORT_METERS)
      ? airportAt(point)
      : null;
  const elevation = (airport?.elevation_ft ?? 0) * FEET;
  if (point.onGround) return { airport, meters: elevation };
  if (
    airport &&
    point.baroAltitude !== null &&
    point.baroAltitude - elevation <= NEAR_GROUND_METERS
  ) {
    return { airport, meters: elevation };
  }
  return null;
}

/**
 * Finds the take-off of the flight the aircraft is on, from its recorded
 * track: the last time it was on or near the ground before climbing out.
 * A track can hold a whole day of flights, so earlier ones are skipped,
 * and so is a landing at the end. It answers null unless the take-off was
 * seen and nothing after it could hide another landing: no long gap low
 * down, no flight longer than any real one.
 */
export function findTakeoff(track: FlightTrack): Takeoff | null {
  const points = track.path
    .filter(
      (point): point is Point =>
        point.latitude !== null &&
        point.longitude !== null &&
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) &&
        Number.isFinite(point.time),
    )
    .sort((first, second) => first.time - second.time);

  let highestAfter = -Infinity;
  let index = -1;
  let ground: Ground | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    // Only a point with a climb out after it can be a take-off, so the
    // low points of a landing at the end are passed over.
    if (highestAfter > -Infinity) {
      const at = groundAt(point);
      if (at && highestAfter - at.meters >= CLIMB_OUT_METERS) {
        index = i;
        ground = at;
        break;
      }
    }
    if (!point.onGround && point.baroAltitude !== null) {
      highestAfter = Math.max(highestAfter, point.baroAltitude);
    }
  }
  if (index < 0 || !ground) return null;

  const takeoff = points[index];
  const last = points[points.length - 1];
  if (last.onGround || last.time - takeoff.time > MAX_FLIGHT_S) return null;
  if (points[index + 1].time - takeoff.time > MAX_TAKEOFF_GAP_S) return null;
  for (let i = index + 1; i + 1 < points.length; i++) {
    const before = points[i];
    const after = points[i + 1];
    if (after.time - before.time <= MAX_UNWATCHED_GAP_S) continue;
    const staysHigh = [before, after].every(
      (point) =>
        !point.onGround &&
        point.baroAltitude !== null &&
        point.baroAltitude >= UNWATCHED_GAP_FLOOR_METERS,
    );
    if (!staysHigh) return null;
  }

  return {
    latitude: takeoff.latitude,
    longitude: takeoff.longitude,
    time: takeoff.time,
    airport: ground.airport,
  };
}

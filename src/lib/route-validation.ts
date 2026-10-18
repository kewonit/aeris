import { haversineDistanceRad } from "./geo";
import type { ReportedRoute, RouteAirport } from "./route-lookup";
import type { Takeoff } from "./takeoff";

const EARTH_RADIUS_NM = 3_440.065;
const FEET = 0.3048;
const LOW_ALTITUDE_METERS = 5_000 * FEET;
/** About 800 ft per minute: a clear climb or descent, not level flight. */
const CLIMBING_METERS_PER_SECOND = 4;
/** Below this, a climb is a departure rather than a step climb at cruise. */
const DEPARTURE_CLIMB_CEILING_METERS = 20_000 * FEET;
/** Below this, a descent is an arrival rather than a step down at cruise. */
const ARRIVAL_DESCENT_CEILING_METERS = 10_000 * FEET;
/**
 * How far past either end an aircraft may be: turning out after take-off,
 * or joining the approach from the far side.
 */
const BEYOND_END_TOLERANCE_NM = 100;
/** Slower than this, the track says little about where it is going. */
const MIN_TRACK_SPEED_MPS = 25;
/** More than this off the course to its destination, it is flying away. */
const FLYING_AWAY_DEG = 100;
/**
 * Departures turn every way within this of the origin, and arrivals are
 * vectored and held within this of the destination, so the way they point
 * says nothing about the route there.
 */
const HEADING_FREE_NM = 50;
/** Holding and circling to land, close in, point anywhere. */
const APPROACH_NM = 25;
/**
 * Above this an aircraft needs well over a mile per thousand feet to get
 * down: 1.5 nm per 1,000 ft is a descent of over 6°, steeper than airliners
 * fly. Closer to its destination than that, it is not landing there.
 */
const HIGH_ALTITUDE_METERS = 25_000 * FEET;
const STEEPEST_DESCENT_NM_PER_1000_FT = 1.5;
/** A departure or arrival this close to an airport starts or ends there. */
const NEAR_ENDPOINT_NM = 50;
/**
 * A route starts where the aircraft was seen taking off when its origin is
 * this close: the first point off the ground can be a few miles from the
 * airport's reference point, but other airports are further off.
 */
const TAKEOFF_MATCH_NM = 5;

export type RoutePosition = {
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  onGround: boolean;
  /** Vertical rate in m/s, positive when climbing. */
  verticalRate?: number | null;
  /** Track over the ground in degrees clockwise from north. */
  track?: number | null;
  /** Ground speed in m/s. */
  speed?: number | null;
};

type Point = { latitude: number; longitude: number };

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function angularDistance(first: Point, second: Point): number {
  return haversineDistanceRad(
    first.longitude,
    first.latitude,
    second.longitude,
    second.latitude,
  );
}

export function distanceNm(first: Point, second: Point): number {
  return angularDistance(first, second) * EARTH_RADIUS_NM;
}

function initialBearing(first: Point, second: Point): number {
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  return Math.atan2(
    Math.sin(longitudeDelta) * Math.cos(secondLatitude),
    Math.cos(firstLatitude) * Math.sin(secondLatitude) -
      Math.sin(firstLatitude) *
        Math.cos(secondLatitude) *
        Math.cos(longitudeDelta),
  );
}

/**
 * How far the position is from the great-circle segment between airports,
 * and whether it lies past one end rather than alongside the segment. Past
 * an end, the distance is to the nearer airport.
 */
function routeOffset(
  position: Point,
  origin: RouteAirport,
  destination: RouteAirport,
): { nm: number; beyondEnd: boolean } {
  const routeDistance = angularDistance(origin, destination);
  if (routeDistance === 0) {
    return { nm: distanceNm(position, origin), beyondEnd: true };
  }

  const originToPosition = angularDistance(origin, position);
  const bearingDelta =
    initialBearing(origin, position) - initialBearing(origin, destination);
  const crossTrack = Math.asin(
    Math.sin(originToPosition) * Math.sin(bearingDelta),
  );
  const alongTrack = Math.atan2(
    Math.sin(originToPosition) * Math.cos(bearingDelta),
    Math.cos(originToPosition),
  );

  if (alongTrack < 0 || alongTrack > routeDistance) {
    return {
      nm: Math.min(
        distanceNm(position, origin),
        distanceNm(position, destination),
      ),
      beyondEnd: true,
    };
  }
  return { nm: Math.abs(crossTrack) * EARTH_RADIUS_NM, beyondEnd: false };
}

/** Distance from the position to the great-circle segment between airports. */
export function distanceToRouteCorridorNm(
  position: Point,
  origin: RouteAirport,
  destination: RouteAirport,
): number {
  return routeOffset(position, origin, destination).nm;
}

type Phase = "departing" | "arriving" | null;

function flightPhase(position: RoutePosition): Phase {
  const rate = position.verticalRate;
  const altitude = position.altitudeMeters;
  if (position.onGround || rate == null || altitude === null) return null;
  if (
    rate > CLIMBING_METERS_PER_SECOND &&
    altitude < DEPARTURE_CLIMB_CEILING_METERS
  ) {
    return "departing";
  }
  if (
    rate < -CLIMBING_METERS_PER_SECOND &&
    altitude < ARRIVAL_DESCENT_CEILING_METERS
  ) {
    return "arriving";
  }
  return null;
}

/** Whether the aircraft is moving and pointing well away from the airport. */
function isFlyingAwayFrom(position: RoutePosition, airport: Point): boolean {
  const { track, speed } = position;
  if (
    position.onGround ||
    track == null ||
    !Number.isFinite(track) ||
    speed == null ||
    !(speed >= MIN_TRACK_SPEED_MPS)
  ) {
    return false;
  }
  const course = (initialBearing(position, airport) * 180) / Math.PI;
  const offCourse = Math.abs((((track - course) % 360) + 540) % 360 - 180);
  return offCourse > FLYING_AWAY_DEG;
}

/**
 * Rejects a reported route only when the aircraft clearly is not flying it:
 * far outside a corridor that widens with route length (airways around
 * closed airspace can bend a long route by hundreds of miles) or well past
 * either end, parked at a different airport, low and nowhere near either
 * end, too high to be landing at the destination it is close to, or flying
 * the route the other way: climbing out near the destination, coming down
 * to land near the origin, or pointing away from the destination while
 * clear of both airports.
 *
 * @param options.ignoreHeading Skip the heading check, for a route already
 *   shown: an aircraft holding far out points away from its destination
 *   half the time, and the route should not flicker.
 */
export function isRouteConsistentWithPosition(
  route: Pick<ReportedRoute, "origin" | "destination">,
  position: RoutePosition,
  options: { ignoreHeading?: boolean } = {},
): boolean {
  const { origin, destination } = route;
  const offset = routeOffset(position, origin, destination);
  const toleranceNm = offset.beyondEnd
    ? BEYOND_END_TOLERANCE_NM
    : Math.max(150, distanceNm(origin, destination) * 0.3);
  if (offset.nm > toleranceNm) return false;

  const toOriginNm = distanceNm(position, origin);
  const toDestinationNm = distanceNm(position, destination);
  const nearestEndpointNm = Math.min(toOriginNm, toDestinationNm);
  if (position.onGround) return nearestEndpointNm <= 15;

  const phase = flightPhase(position);
  // Past 20 nm so a go-around at the destination still counts as arriving.
  if (
    phase === "departing" &&
    toDestinationNm > 20 &&
    toDestinationNm < toOriginNm
  ) {
    return false;
  }
  if (
    phase === "arriving" &&
    toDestinationNm > 40 &&
    toOriginNm * 2 < toDestinationNm
  ) {
    return false;
  }

  const altitude = position.altitudeMeters;
  if (
    altitude !== null &&
    altitude > HIGH_ALTITUDE_METERS &&
    toDestinationNm <
      (altitude / FEET / 1_000) * STEEPEST_DESCENT_NM_PER_1000_FT
  ) {
    return false;
  }
  if (
    !options.ignoreHeading &&
    nearestEndpointNm > HEADING_FREE_NM &&
    isFlyingAwayFrom(position, destination)
  ) {
    return false;
  }
  if (altitude !== null && altitude < LOW_ALTITUDE_METERS) {
    return nearestEndpointNm <= 100;
  }
  return true;
}

/**
 * Orders routes that all fit the position, best first. A climb-out or a
 * descent to land happens near the airport the route starts or ends at; a
 * route the aircraft is pointing towards beats one it points away from; and
 * one it is right on beats one it is hundreds of miles off. Routes that fit
 * about as well keep the route already shown, then provider order.
 */
function rankKey(
  route: ReportedRoute,
  position: RoutePosition,
  isCurrent: boolean,
  index: number,
): number[] {
  const toOriginNm = distanceNm(position, route.origin);
  const toDestinationNm = distanceNm(position, route.destination);
  const phase = flightPhase(position);
  const phaseMiss =
    (phase === "departing" && toOriginNm > NEAR_ENDPOINT_NM) ||
    (phase === "arriving" && toDestinationNm > NEAR_ENDPOINT_NM);
  const flyingAway =
    toDestinationNm > APPROACH_NM &&
    isFlyingAwayFrom(position, route.destination);
  // Offsets count in steps that grow with the route, so small differences
  // between airways do not override provider order.
  const offsetStep = Math.max(
    100,
    distanceNm(route.origin, route.destination) * 0.1,
  );
  const offset = Math.floor(
    distanceToRouteCorridorNm(position, route.origin, route.destination) /
      offsetStep,
  );
  return [
    phaseMiss ? 1 : 0,
    flyingAway ? 1 : 0,
    offset,
    isCurrent ? 0 : 1,
    index,
  ];
}

function compareKeys(first: number[], second: number[]): number {
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) return first[i] - second[i];
  }
  return 0;
}

/** adsbdb names a few airports by IATA code alone. */
function isSameAirport(first: RouteAirport, second: RouteAirport): boolean {
  return (first.icao || first.iata) === (second.icao || second.iata);
}

export function isSameLeg(
  first: Pick<ReportedRoute, "origin" | "destination">,
  second: Pick<ReportedRoute, "origin" | "destination">,
): boolean {
  return (
    isSameAirport(first.origin, second.origin) &&
    isSameAirport(first.destination, second.destination)
  );
}

/**
 * Picks the reported leg the aircraft is flying: of those that fit the
 * position, the one that fits best, in provider order among equals. A
 * flight number that calls at several airports offers each leg, and
 * providers often disagree, so the order alone is not enough. Without a
 * position there is nothing to check against, so the first leg stands.
 *
 * @param options.current The leg shown for this aircraft until now, which
 *   keeps its place while it still fits.
 * @param options.departedFrom Where the aircraft was seen taking off on
 *   this flight. Only a leg from there can be the one it is flying.
 */
export function selectReportedRoute(
  routes: readonly ReportedRoute[],
  position: RoutePosition | null,
  options: {
    current?: ReportedRoute | null;
    departedFrom?: Point | null;
  } = {},
): ReportedRoute | null {
  if (!position) return routes[0] ?? null;
  const current = options.current ?? null;
  // Once landed, the callsign may already name the next flight.
  const departedFrom = position.onGround ? null : options.departedFrom;

  let best: { route: ReportedRoute; key: number[] } | null = null;
  for (const [index, route] of routes.entries()) {
    if (
      departedFrom &&
      distanceNm(route.origin, departedFrom) > TAKEOFF_MATCH_NM
    ) {
      continue;
    }
    const isCurrent = current !== null && isSameLeg(route, current);
    if (
      !isRouteConsistentWithPosition(route, position, {
        ignoreHeading: isCurrent,
      })
    ) {
      continue;
    }
    const key = rankKey(route, position, isCurrent, index);
    if (!best || compareKeys(key, best.key) < 0) best = { route, key };
  }
  return best?.route ?? null;
}

/**
 * The airport an aircraft was seen taking off from, named as the reported
 * routes name it when one of them lists it, so it reads like any other
 * route, else from the app's own airport list.
 */
export function takeoffAirport(
  takeoff: Takeoff,
  routes: readonly ReportedRoute[],
): RouteAirport | null {
  for (const route of routes) {
    for (const airport of [route.origin, route.destination]) {
      if (distanceNm(airport, takeoff) <= TAKEOFF_MATCH_NM) return airport;
    }
  }
  const listed = takeoff.airport;
  if (!listed) return null;
  return {
    iata: listed.iata,
    icao: listed.icao,
    name: listed.name,
    municipality: listed.city,
    countryIso: listed.country,
    latitude: listed.lat,
    longitude: listed.lng,
  };
}

import { haversineDistanceRad } from "./geo";
import type { ReportedRoute, RouteAirport } from "./route-lookup";

const EARTH_RADIUS_NM = 3_440.065;
const LOW_ALTITUDE_METERS = 5_000 * 0.3048;
/** About 800 ft per minute: a clear climb, not level-flight noise. */
const CLIMBING_METERS_PER_SECOND = 4;
/** Below this, a climb is a departure rather than a step climb at cruise. */
const DEPARTURE_CLIMB_CEILING_METERS = 20_000 * 0.3048;

export type RoutePosition = {
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  onGround: boolean;
  /** Vertical rate in m/s, positive when climbing. */
  verticalRate?: number | null;
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

/** Distance from the position to the great-circle segment between airports. */
export function distanceToRouteCorridorNm(
  position: Point,
  origin: RouteAirport,
  destination: RouteAirport,
): number {
  const routeDistance = angularDistance(origin, destination);
  if (routeDistance === 0) return distanceNm(position, origin);

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
    return Math.min(
      distanceNm(position, origin),
      distanceNm(position, destination),
    );
  }
  return Math.abs(crossTrack) * EARTH_RADIUS_NM;
}

/**
 * Rejects a reported route only when the aircraft clearly is not flying it:
 * far outside a corridor that widens with route length (airways around
 * closed airspace can bend a long route by hundreds of miles), parked at a
 * different airport, low and nowhere near either end, or climbing out
 * near the destination, which means the route runs the other way.
 */
export function isRouteConsistentWithPosition(
  route: Pick<ReportedRoute, "origin" | "destination">,
  position: RoutePosition,
): boolean {
  const { origin, destination } = route;
  const toleranceNm = Math.max(150, distanceNm(origin, destination) * 0.3);
  if (distanceToRouteCorridorNm(position, origin, destination) > toleranceNm) {
    return false;
  }

  const nearestEndpointNm = Math.min(
    distanceNm(position, origin),
    distanceNm(position, destination),
  );
  if (position.onGround) return nearestEndpointNm <= 15;

  const toDestinationNm = distanceNm(position, destination);
  const departing =
    position.verticalRate != null &&
    position.verticalRate > CLIMBING_METERS_PER_SECOND &&
    position.altitudeMeters !== null &&
    position.altitudeMeters < DEPARTURE_CLIMB_CEILING_METERS;
  // Past 20 nm so a go-around at the destination still counts as arriving.
  if (
    departing &&
    toDestinationNm > 20 &&
    toDestinationNm < distanceNm(position, origin)
  ) {
    return false;
  }
  if (
    position.altitudeMeters !== null &&
    position.altitudeMeters < LOW_ALTITUDE_METERS
  ) {
    return nearestEndpointNm <= 100;
  }
  return true;
}

/**
 * Picks the first route, in provider priority order, that fits the
 * position. Without a position there is nothing to check against, so the
 * first reported route stands.
 */
export function selectReportedRoute(
  routes: readonly ReportedRoute[],
  position: RoutePosition | null,
): ReportedRoute | null {
  if (!position) return routes[0] ?? null;
  return (
    routes.find((route) => isRouteConsistentWithPosition(route, position)) ??
    null
  );
}

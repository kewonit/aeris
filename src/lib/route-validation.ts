import type { RouteAirport } from "./route-lookup";

const EARTH_RADIUS_NM = 3_440.065;
const FEET_TO_METERS = 0.3048;

export type RoutePositionContext = {
  icao24: string;
  callsign: string;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  onGround: boolean;
  observationTime: number;
};

export type RouteValidationResult = {
  valid: boolean;
  reason: "valid" | "corridor" | "ground-endpoint" | "low-endpoint";
  corridorDistanceNm: number;
  corridorToleranceNm: number;
  nearestEndpointNm: number;
};

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function angularDistance(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number {
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const latitudeDelta = secondLatitude - firstLatitude;
  const longitudeDelta = radians(second.longitude - first.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function initialBearing(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number {
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

export function distanceNm(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number {
  return angularDistance(first, second) * EARTH_RADIUS_NM;
}

export function distanceToRouteCorridorNm(
  position: { latitude: number; longitude: number },
  origin: RouteAirport,
  destination: RouteAirport,
): number {
  const routeDistance = angularDistance(origin, destination);
  if (routeDistance === 0) return distanceNm(position, origin);

  const originToPosition = angularDistance(origin, position);
  const routeBearing = initialBearing(origin, destination);
  const positionBearing = initialBearing(origin, position);
  const bearingDelta = positionBearing - routeBearing;
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

export function validateReportedRoute(
  origin: RouteAirport,
  destination: RouteAirport,
  context: RoutePositionContext,
): RouteValidationResult {
  const position = {
    latitude: context.latitude,
    longitude: context.longitude,
  };
  const routeDistanceNm = distanceNm(origin, destination);
  const corridorToleranceNm = Math.min(
    250,
    Math.max(50, routeDistanceNm * 0.15),
  );
  const corridorDistanceNm = distanceToRouteCorridorNm(
    position,
    origin,
    destination,
  );
  const nearestEndpointNm = Math.min(
    distanceNm(position, origin),
    distanceNm(position, destination),
  );

  if (corridorDistanceNm > corridorToleranceNm) {
    return {
      valid: false,
      reason: "corridor",
      corridorDistanceNm,
      corridorToleranceNm,
      nearestEndpointNm,
    };
  }
  if (context.onGround && nearestEndpointNm > 15) {
    return {
      valid: false,
      reason: "ground-endpoint",
      corridorDistanceNm,
      corridorToleranceNm,
      nearestEndpointNm,
    };
  }
  if (
    context.altitudeMeters !== null &&
    context.altitudeMeters < 10_000 * FEET_TO_METERS &&
    nearestEndpointNm > 150
  ) {
    return {
      valid: false,
      reason: "low-endpoint",
      corridorDistanceNm,
      corridorToleranceNm,
      nearestEndpointNm,
    };
  }
  return {
    valid: true,
    reason: "valid",
    corridorDistanceNm,
    corridorToleranceNm,
    nearestEndpointNm,
  };
}

import { snapLngToReference } from "@/lib/geo";
import type { FlightState } from "@/lib/opensky";

import type { ElevatedPoint } from "./flight-layer-constants";

const CONNECTOR_MIN_HORIZONTAL_DELTA = 1e-6;
const CONNECTOR_MIN_ALTITUDE_DELTA_METERS = 1;
const CONNECTOR_CONTROL_SCALE = 0.38;
const CONNECTOR_MAX_CONTROL_DEGREES = 0.06;
const CONNECTOR_SEGMENTS = 10;
const DEFAULT_CONNECTOR_TAIL_GAP_METERS = 24;
const CONNECTOR_MIN_GAP_RETENTION = 0.82;

export type TrailConnectorCalibration = {
  tailGapMeters?: number;
};

function normalizeDirection(dx: number, dy: number): [number, number] {
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) {
    return [0, 0];
  }
  return [dx / length, dy / length];
}

function headingDirection(track: number): [number, number] {
  const radians = (track * Math.PI) / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

function dotDirection(left: [number, number], right: [number, number]): number {
  return left[0] * right[0] + left[1] * right[1];
}

function blendDirections(
  primary: [number, number],
  secondary: [number, number],
  secondaryWeight: number,
): [number, number] {
  const primaryWeight = 1 - secondaryWeight;
  return normalizeDirection(
    primary[0] * primaryWeight + secondary[0] * secondaryWeight,
    primary[1] * primaryWeight + secondary[1] * secondaryWeight,
  );
}

function averageTailDirection(
  trailPoints: ElevatedPoint[],
): [number, number] | null {
  if (trailPoints.length < 2) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;
  let weight = 1;

  for (
    let index = Math.max(1, trailPoints.length - 4);
    index < trailPoints.length;
    index += 1
  ) {
    const prev = trailPoints[index - 1];
    const current = trailPoints[index];
    const [dirX, dirY] = normalizeDirection(
      current[0] - prev[0],
      current[1] - prev[1],
    );

    if (dirX === 0 && dirY === 0) {
      continue;
    }

    sumX += dirX * weight;
    sumY += dirY * weight;
    totalWeight += weight;
    weight += 1;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return normalizeDirection(sumX, sumY);
}

function metersPerDegreeLongitude(latitude: number): number {
  return Math.max(111_320 * Math.cos((latitude * Math.PI) / 180), 1);
}

function horizontalDistanceMeters(
  dxDegrees: number,
  dyDegrees: number,
  latitude: number,
): number {
  return Math.hypot(
    dxDegrees * metersPerDegreeLongitude(latitude),
    dyDegrees * 111_320,
  );
}

function offsetPointAlongDirection(
  lng: number,
  lat: number,
  direction: [number, number],
  distanceMeters: number,
): [number, number] {
  return [
    lng + direction[0] * (distanceMeters / metersPerDegreeLongitude(lat)),
    lat + direction[1] * (distanceMeters / 111_320),
  ];
}

function cubicBezierPoint(
  p0: ElevatedPoint,
  p1: ElevatedPoint,
  p2: ElevatedPoint,
  p3: ElevatedPoint,
  t: number,
): ElevatedPoint {
  const oneMinusT = 1 - t;
  const a = oneMinusT * oneMinusT * oneMinusT;
  const b = 3 * oneMinusT * oneMinusT * t;
  const c = 3 * oneMinusT * t * t;
  const d = t * t * t;

  return [
    p0[0] * a + p1[0] * b + p2[0] * c + p3[0] * d,
    p0[1] * a + p1[1] * b + p2[1] * c + p3[1] * d,
    p0[2] * a + p1[2] * b + p2[2] * c + p3[2] * d,
  ];
}

export function buildTrailConnector(
  trailPoints: ElevatedPoint[],
  aircraft: FlightState | undefined,
  calibration?: TrailConnectorCalibration,
): ElevatedPoint[] | null {
  const tailPoint = trailPoints[trailPoints.length - 1] ?? null;
  const prevPoint =
    trailPoints.length > 1 ? trailPoints[trailPoints.length - 2] : null;

  if (
    !tailPoint ||
    !aircraft ||
    aircraft.longitude == null ||
    aircraft.latitude == null
  ) {
    return null;
  }

  const tail: ElevatedPoint = [
    tailPoint[0],
    tailPoint[1],
    Number.isFinite(tailPoint[2]) ? Math.max(0, tailPoint[2]) : 0,
  ];

  const aircraftCenterLng = snapLngToReference(aircraft.longitude, tail[0]);
  const aircraftCenterLat = aircraft.latitude;
  const aircraftAltitude =
    aircraft.baroAltitude != null && Number.isFinite(aircraft.baroAltitude)
      ? Math.max(0, aircraft.baroAltitude)
      : tail[2];

  const dx = aircraftCenterLng - tail[0];
  const dy = aircraftCenterLat - tail[1];
  const dz = aircraftAltitude - tail[2];
  if (
    Math.abs(dx) < CONNECTOR_MIN_HORIZONTAL_DELTA &&
    Math.abs(dy) < CONNECTOR_MIN_HORIZONTAL_DELTA &&
    Math.abs(dz) < CONNECTOR_MIN_ALTITUDE_DELTA_METERS
  ) {
    return null;
  }

  const averagedStartDirection = averageTailDirection(trailPoints);
  const [startDirX, startDirY] = prevPoint
    ? (averagedStartDirection ??
      normalizeDirection(tail[0] - prevPoint[0], tail[1] - prevPoint[1]))
    : normalizeDirection(dx, dy);
  const gapDirection = normalizeDirection(dx, dy);
  const fallbackDirection: [number, number] = [
    gapDirection[0],
    gapDirection[1],
  ];
  const headingDirectionVector: [number, number] | null =
    aircraft.trueTrack != null && Number.isFinite(aircraft.trueTrack)
      ? headingDirection(aircraft.trueTrack)
      : null;
  const headingAlignment = headingDirectionVector
    ? dotDirection(headingDirectionVector, gapDirection)
    : 1;
  const endDirection: [number, number] =
    headingDirectionVector && headingAlignment > 0.55
      ? blendDirections(gapDirection, headingDirectionVector, 0.3)
      : headingDirectionVector && headingAlignment < -0.2
        ? headingDirectionVector
        : fallbackDirection;
  const resolvedFallback: [number, number] =
    fallbackDirection[0] !== 0 || fallbackDirection[1] !== 0
      ? fallbackDirection
      : (headingDirectionVector ?? [0, 1]);
  const resolvedEnd: [number, number] =
    endDirection[0] !== 0 || endDirection[1] !== 0
      ? endDirection
      : (headingDirectionVector ?? [0, 1]);
  const [fallbackDirX, fallbackDirY] = resolvedFallback;
  const [endDirX, endDirY] = resolvedEnd;

  const tailGapMeters = Math.max(
    0,
    calibration?.tailGapMeters ?? DEFAULT_CONNECTOR_TAIL_GAP_METERS,
  );

  const tailAnchorMeters = Math.min(
    tailGapMeters,
    horizontalDistanceMeters(dx, dy, aircraftCenterLat) *
      CONNECTOR_MIN_GAP_RETENTION,
  );

  // Use the aircraft heading direction for the head offset — this matches
  // the model layer's offsetPositionByTrack(pos, trueTrack, -tailAnchor)
  // so the connector head consistently arrives at the model's tail.
  const headOffsetDir: [number, number] =
    headingDirectionVector ?? gapDirection;
  const [headLng, headLat] = offsetPointAlongDirection(
    aircraftCenterLng,
    aircraftCenterLat,
    [-headOffsetDir[0], -headOffsetDir[1]],
    tailAnchorMeters,
  );
  const head: ElevatedPoint = [
    snapLngToReference(headLng, tail[0]),
    headLat,
    aircraftAltitude,
  ];

  const controlDistance = Math.min(
    CONNECTOR_MAX_CONTROL_DEGREES,
    Math.max(Math.hypot(dx, dy) * CONNECTOR_CONTROL_SCALE, 0),
  );

  const control1: ElevatedPoint = [
    tail[0] + (startDirX || fallbackDirX) * controlDistance,
    tail[1] + (startDirY || fallbackDirY) * controlDistance,
    tail[2] + dz * 0.42,
  ];

  const control2: ElevatedPoint = [
    head[0] - (endDirX || fallbackDirX) * controlDistance,
    head[1] - (endDirY || fallbackDirY) * controlDistance,
    head[2] - dz * 0.12,
  ];

  const connector: ElevatedPoint[] = [];
  for (let index = 0; index <= CONNECTOR_SEGMENTS; index += 1) {
    const t = index / CONNECTOR_SEGMENTS;
    connector.push(cubicBezierPoint(tail, control1, control2, head, t));
  }

  connector[0] = tail;
  connector[connector.length - 1] = head;

  return connector;
}

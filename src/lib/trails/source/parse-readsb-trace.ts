import type { FlightTrack, TrackWaypoint } from "@/lib/opensky-types";

const FT_TO_M = 0.3048;
const TARGET_WAYPOINTS = 240;
const MAX_AGE_SECONDS = 120 * 60;
const MIN_GROUND_FOR_SPLIT = 2;
const MODERATE_CONTINUITY_GAP_SECONDS = 5 * 60;
const HARD_CONTINUITY_GAP_SECONDS = 15 * 60;
const LOW_ALTITUDE_CONTINUITY_M = 2_000;
const BASE_CONTINUITY_DISTANCE_M = 12_000;
const MAX_CONTINUITY_SPEED_MPS = 450;

function trimToLastFlight(waypoints: TrackWaypoint[]): TrackWaypoint[] {
  if (waypoints.length < 3) {
    return waypoints;
  }

  const legs = splitIntoCandidateLegs(waypoints);

  for (let index = legs.length - 1; index >= 0; index -= 1) {
    if (legs[index].length >= 2) {
      return retainShortRunwayRoll(legs[index]);
    }
  }

  return retainShortRunwayRoll(legs[legs.length - 1] ?? waypoints);
}

function retainShortRunwayRoll(waypoints: TrackWaypoint[]): TrackWaypoint[] {
  if (waypoints.length < 3) {
    return waypoints;
  }

  let lastTakeoffIdx = -1;

  for (let index = 1; index < waypoints.length; index += 1) {
    if (!waypoints[index].onGround && waypoints[index - 1].onGround) {
      let groundCount = 0;
      for (let scan = index - 1; scan >= 0; scan -= 1) {
        if (waypoints[scan].onGround) {
          groundCount += 1;
          continue;
        }
        break;
      }

      if (groundCount >= MIN_GROUND_FOR_SPLIT) {
        lastTakeoffIdx = index;
      }
    }
  }

  if (lastTakeoffIdx <= 0) {
    return waypoints;
  }

  return waypoints.slice(Math.max(0, lastTakeoffIdx - 1));
}

function approximateDistanceMeters(
  left: TrackWaypoint,
  right: TrackWaypoint,
): number {
  const leftLat = left.latitude ?? 0;
  const rightLat = right.latitude ?? 0;
  const leftLng = left.longitude ?? 0;
  const rightLng = right.longitude ?? 0;
  const avgLatRad = ((leftLat + rightLat) / 2) * (Math.PI / 180);
  const metersPerLngDegree = 111_320 * Math.cos(avgLatRad);
  const dx = (rightLng - leftLng) * metersPerLngDegree;
  const dy = (rightLat - leftLat) * 111_320;
  return Math.hypot(dx, dy);
}

function isLowAltitudeContinuityPoint(waypoint: TrackWaypoint): boolean {
  return (
    waypoint.onGround ||
    (waypoint.baroAltitude != null &&
      waypoint.baroAltitude <= LOW_ALTITUDE_CONTINUITY_M)
  );
}

function isContinuityBreak(
  previous: TrackWaypoint,
  current: TrackWaypoint,
): boolean {
  const gapSeconds = current.time - previous.time;
  if (!Number.isFinite(gapSeconds) || gapSeconds <= 0) {
    return true;
  }

  if (gapSeconds >= HARD_CONTINUITY_GAP_SECONDS) {
    return true;
  }

  if (
    gapSeconds >= MODERATE_CONTINUITY_GAP_SECONDS &&
    (isLowAltitudeContinuityPoint(previous) ||
      isLowAltitudeContinuityPoint(current))
  ) {
    return true;
  }

  const maxDistanceMeters =
    BASE_CONTINUITY_DISTANCE_M + MAX_CONTINUITY_SPEED_MPS * gapSeconds;
  return approximateDistanceMeters(previous, current) > maxDistanceMeters;
}

function splitIntoCandidateLegs(waypoints: TrackWaypoint[]): TrackWaypoint[][] {
  if (waypoints.length === 0) {
    return [];
  }

  const legs: TrackWaypoint[][] = [];
  let currentLeg: TrackWaypoint[] = [waypoints[0]];

  for (let index = 1; index < waypoints.length; index += 1) {
    const previous = waypoints[index - 1];
    const current = waypoints[index];

    if (isContinuityBreak(previous, current)) {
      legs.push(currentLeg);
      currentLeg = [current];
      continue;
    }

    currentLeg.push(current);
  }

  legs.push(currentLeg);
  return legs;
}

function waypointPerpendicularDist(
  point: TrackWaypoint,
  start: TrackWaypoint,
  end: TrackWaypoint,
): number {
  const startLat = start.latitude!;
  const startLng = start.longitude!;
  const endLat = end.latitude!;
  const endLng = end.longitude!;
  const pointLat = point.latitude!;
  const pointLng = point.longitude!;

  const avgLat = ((startLat + endLat + pointLat) / 3) * (Math.PI / 180);
  const cosLat = Math.cos(avgLat);

  const ax = startLng * cosLat;
  const ay = startLat;
  const bx = endLng * cosLat;
  const by = endLat;
  const px = pointLng * cosLat;
  const py = pointLat;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;

  if (abLenSq < 1e-12) {
    return Math.sqrt(apx * apx + apy * apy);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const projX = ax + t * abx;
  const projY = ay + t * aby;
  const dx = px - projX;
  const dy = py - projY;

  return Math.sqrt(dx * dx + dy * dy);
}

function rdpSimplifyWaypoints(
  points: TrackWaypoint[],
  epsilon: number,
): TrackWaypoint[] {
  if (points.length <= 2) {
    return points.slice();
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIndex = start;

    for (let index = start + 1; index < end; index += 1) {
      const distance = waypointPerpendicularDist(
        points[index],
        points[start],
        points[end],
      );
      if (distance > maxDist) {
        maxDist = distance;
        maxIndex = index;
      }
    }

    if (maxDist > epsilon) {
      keep[maxIndex] = 1;
      if (maxIndex - start > 1) {
        stack.push([start, maxIndex]);
      }
      if (end - maxIndex > 1) {
        stack.push([maxIndex, end]);
      }
    }
  }

  const simplified: TrackWaypoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (keep[index]) {
      simplified.push(points[index]);
    }
  }

  return simplified;
}

function downsamplePreservingCurves(
  points: TrackWaypoint[],
  target: number,
): TrackWaypoint[] {
  if (points.length <= target) {
    return points;
  }

  let low = 0;
  let high = 5;
  let best = points;

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const mid = (low + high) / 2;
    const result = rdpSimplifyWaypoints(points, mid);
    if (result.length <= target) {
      best = result;
      high = mid;
    } else {
      low = mid;
    }

    if (Math.abs(result.length - target) < target * 0.05) {
      break;
    }
  }

  if (best.length < target * 0.5 && points.length > target) {
    const sampled: TrackWaypoint[] = [points[0]];
    const step = (points.length - 1) / (target - 1);
    for (let index = 1; index < target - 1; index += 1) {
      sampled.push(points[Math.round(index * step)]);
    }
    sampled.push(points[points.length - 1]);
    return sampled;
  }

  return best;
}

export function normalizeTrackWaypoints(
  waypoints: TrackWaypoint[],
): TrackWaypoint[] {
  if (waypoints.length < 2) {
    return [];
  }

  const sortedWaypoints = waypoints
    .slice()
    .sort((left, right) => left.time - right.time);
  const legTrimmed = trimToLastFlight(sortedWaypoints);
  if (legTrimmed.length < 2) {
    return [];
  }

  const deduped: TrackWaypoint[] = [legTrimmed[0]];

  for (let index = 1; index < legTrimmed.length; index += 1) {
    const previous = deduped[deduped.length - 1];
    const current = legTrimmed[index];
    const dLat = (current.latitude ?? 0) - (previous.latitude ?? 0);
    const dLng = (current.longitude ?? 0) - (previous.longitude ?? 0);
    if (dLat * dLat + dLng * dLng < 0.0003 * 0.0003) {
      if (current.baroAltitude != null && previous.baroAltitude == null) {
        deduped[deduped.length - 1] = current;
      }
      continue;
    }
    deduped.push(current);
  }

  if (deduped.length < 2) {
    return [];
  }

  return downsamplePreservingCurves(deduped, TARGET_WAYPOINTS);
}

export function parseReadsbTrace(
  hex: string,
  data: unknown,
): FlightTrack | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const object = data as Record<string, unknown>;
  const timestamp =
    typeof object.timestamp === "number" && Number.isFinite(object.timestamp)
      ? object.timestamp
      : 0;
  const rawTrace = Array.isArray(object.trace) ? object.trace : null;

  if (timestamp <= 0 || !rawTrace || rawTrace.length < 2) {
    return null;
  }

  let latestOffset = 0;
  for (const entry of rawTrace) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === "number" &&
      entry[0] > latestOffset
    ) {
      latestOffset = entry[0];
    }
  }

  const cutoffOffset = latestOffset - MAX_AGE_SECONDS;
  let lastNewLegOffset = Number.NEGATIVE_INFINITY;
  let hasNewLegFlag = false;

  for (const entry of rawTrace) {
    if (!Array.isArray(entry) || entry.length < 7) {
      continue;
    }

    const offset = typeof entry[0] === "number" ? entry[0] : null;
    const flags = typeof entry[6] === "number" ? entry[6] : 0;

    if (offset === null || !Number.isFinite(offset) || offset < cutoffOffset) {
      continue;
    }
    if (flags & 1) {
      continue;
    }
    if (flags & 2) {
      lastNewLegOffset = offset;
      hasNewLegFlag = true;
    }
  }

  const legCutoff = hasNewLegFlag
    ? lastNewLegOffset - 90
    : Number.NEGATIVE_INFINITY;
  const waypoints: TrackWaypoint[] = [];

  for (const entry of rawTrace) {
    if (!Array.isArray(entry) || entry.length < 4) {
      continue;
    }

    const offset = typeof entry[0] === "number" ? entry[0] : null;
    if (
      offset === null ||
      !Number.isFinite(offset) ||
      offset < cutoffOffset ||
      offset < legCutoff
    ) {
      continue;
    }

    const flags = typeof entry[6] === "number" ? entry[6] : 0;
    if (flags & 1) {
      continue;
    }

    const latitude = typeof entry[1] === "number" ? entry[1] : null;
    const longitude = typeof entry[2] === "number" ? entry[2] : null;
    if (
      latitude === null ||
      longitude === null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      continue;
    }

    const rawAltitude = entry[3];
    const onGround = rawAltitude === "ground";
    let baroAltitude: number | null = null;
    if (onGround) {
      baroAltitude = 0;
    } else if (
      typeof rawAltitude === "number" &&
      Number.isFinite(rawAltitude)
    ) {
      baroAltitude = rawAltitude * FT_TO_M;
    }

    const trueTrack =
      entry.length > 5 &&
      typeof entry[5] === "number" &&
      Number.isFinite(entry[5])
        ? entry[5]
        : null;

    waypoints.push({
      time: timestamp + offset,
      latitude,
      longitude,
      baroAltitude,
      trueTrack,
      onGround,
    });
  }

  if (waypoints.length < 2) {
    return null;
  }

  const sampled = normalizeTrackWaypoints(waypoints);
  if (sampled.length < 2) {
    return null;
  }

  return {
    icao24: hex.trim().toLowerCase(),
    startTime: Math.floor(sampled[0].time),
    endTime: Math.floor(sampled[sampled.length - 1].time),
    callsign: null,
    path: sampled,
  };
}

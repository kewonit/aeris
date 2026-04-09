import type { TrailEntry } from "@/hooks/use-trail-history";

import type { ElevatedPoint } from "./flight-layer-constants";
import { cleanupDisplayCurve } from "./trail-curve-cleanup";
import { buildTrailBasePath } from "./trail-base-path";

const PREVIEW_RENDER_POINTS = 21;
const MIN_ACTIVE_RENDER_POINTS = PREVIEW_RENDER_POINTS + 8;
const ACTIVE_RENDER_POINTS_PER_DISTANCE = 6;

export type TrailDisplayGeometry = {
  sealedBody: ElevatedPoint[];
  previewHead: ElevatedPoint[];
  allPoints: ElevatedPoint[];
};

function dedupePoints(points: ElevatedPoint[]): ElevatedPoint[] {
  const result: ElevatedPoint[] = [];

  for (const point of points) {
    const normalized: ElevatedPoint = [
      point[0],
      point[1],
      Number.isFinite(point[2]) ? Math.max(0, point[2]) : 0,
    ];
    const last = result[result.length - 1];

    if (
      last &&
      last[0] === normalized[0] &&
      last[1] === normalized[1] &&
      last[2] === normalized[2]
    ) {
      continue;
    }

    result.push(normalized);
  }

  return result;
}

function clipFromOldestEnd(
  points: ElevatedPoint[],
  trailDistance: number,
): ElevatedPoint[] {
  const maxPoints = Math.max(
    MIN_ACTIVE_RENDER_POINTS,
    Math.round(trailDistance) * ACTIVE_RENDER_POINTS_PER_DISTANCE,
  );
  if (points.length <= maxPoints) {
    return points;
  }
  return points.slice(points.length - maxPoints);
}

function splitContinuousCurve(points: ElevatedPoint[]): TrailDisplayGeometry {
  const previewHead = points.slice(
    Math.max(0, points.length - PREVIEW_RENDER_POINTS),
  );

  return {
    sealedBody: points.slice(0, points.length - previewHead.length),
    previewHead,
    allPoints: points,
  };
}

export function buildTrailDisplayGeometry(
  trail: TrailEntry,
  trailDistance: number,
): TrailDisplayGeometry {
  if (trail.path.length < 2) {
    return { sealedBody: [], previewHead: [], allPoints: [] };
  }

  const continuous = dedupePoints(
    cleanupDisplayCurve(buildTrailBasePath(trail, trailDistance)),
  );
  const clipped = trail.fullHistory
    ? continuous
    : dedupePoints(clipFromOldestEnd(continuous, trailDistance));

  return splitContinuousCurve(clipped);
}

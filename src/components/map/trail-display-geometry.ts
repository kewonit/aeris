import type { TrailEntry } from "@/hooks/use-trail-history";

import type { ElevatedPoint } from "./flight-layer-constants";
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

function collapseDisplayBacktracks(points: ElevatedPoint[]): ElevatedPoint[] {
  if (points.length < 4) {
    return points;
  }

  const result = points.map(
    (point) => [point[0], point[1], point[2]] as ElevatedPoint,
  );

  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;

    for (let index = 1; index < result.length - 2; index += 1) {
      const prev = result[index - 1];
      const current = result[index];
      const next = result[index + 1];
      const following = result[index + 2];

      const dx = following[0] - prev[0];
      const dy = following[1] - prev[1];
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-12) {
        continue;
      }

      const currentProjection =
        ((current[0] - prev[0]) * dx + (current[1] - prev[1]) * dy) / lenSq;
      const nextProjection =
        ((next[0] - prev[0]) * dx + (next[1] - prev[1]) * dy) / lenSq;
      const currentCross =
        dx * (current[1] - prev[1]) - dy * (current[0] - prev[0]);
      const nextCross = dx * (next[1] - prev[1]) - dy * (next[0] - prev[0]);

      const len1 = Math.hypot(current[0] - prev[0], current[1] - prev[1]);
      const len2 = Math.hypot(next[0] - current[0], next[1] - current[1]);
      const len3 = Math.hypot(following[0] - next[0], following[1] - next[1]);
      const direct = Math.sqrt(lenSq);
      const detourRatio = (len1 + len2 + len3) / Math.max(direct, 1e-10);
      const crossTrackRatio =
        Math.max(Math.abs(currentCross), Math.abs(nextCross)) /
        Math.max(direct, 1e-10);
      const backtracks = nextProjection < currentProjection - 0.02;
      const swingsAcross = currentCross * nextCross < 0;

      if (
        backtracks &&
        detourRatio > 1.08 &&
        (swingsAcross || crossTrackRatio > 0.0015)
      ) {
        result.splice(index, 2);
        changed = true;
        break;
      }
    }

    if (!changed) {
      break;
    }
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

  const continuous = collapseDisplayBacktracks(
    dedupePoints(buildTrailBasePath(trail, trailDistance)),
  );
  const clipped = trail.fullHistory
    ? continuous
    : dedupePoints(clipFromOldestEnd(continuous, trailDistance));

  return splitContinuousCurve(clipped);
}

import type { TrailEntry } from "@/hooks/use-trail-history";

import type { ElevatedPoint } from "./flight-layer-constants";
import { buildTrailBasePath } from "./trail-base-path";

const PREVIEW_SOURCE_POINTS = 4;
const PREVIEW_RENDER_POINTS = 21;
const MIN_ACTIVE_RENDER_POINTS = PREVIEW_RENDER_POINTS + 8;
const ACTIVE_RENDER_POINTS_PER_DISTANCE = 6;

export type TrailDisplayGeometry = {
  sealedBody: ElevatedPoint[];
  previewHead: ElevatedPoint[];
  allPoints: ElevatedPoint[];
};

function sliceTrail(trail: TrailEntry, start: number, end: number): TrailEntry {
  return {
    ...trail,
    path: trail.path.slice(start, end),
    altitudes: trail.altitudes.slice(start, end),
    timestamps: trail.timestamps.slice(start, end),
    baroAltitude:
      trail.altitudes[Math.min(trail.altitudes.length - 1, end - 1)] ??
      trail.baroAltitude,
  };
}

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

export function buildTrailDisplayGeometry(
  trail: TrailEntry,
  trailDistance: number,
): TrailDisplayGeometry {
  if (trail.path.length < 2) {
    return { sealedBody: [], previewHead: [], allPoints: [] };
  }

  if (trail.path.length <= PREVIEW_SOURCE_POINTS) {
    const allPoints = buildTrailBasePath(trail, trail.path.length);
    const normalized = trail.fullHistory
      ? dedupePoints(allPoints)
      : dedupePoints(clipFromOldestEnd(allPoints, trailDistance));
    const previewHead = normalized.slice(
      Math.max(0, normalized.length - PREVIEW_RENDER_POINTS),
    );
    const sealedBody = normalized.slice(
      0,
      normalized.length - previewHead.length,
    );
    return { sealedBody, previewHead, allPoints: normalized };
  }

  const matureCount = Math.max(2, trail.path.length - 1);
  const matureTrail = sliceTrail(trail, 0, matureCount);
  const matureDense = buildTrailBasePath(matureTrail, matureTrail.path.length);
  const sealedBody = matureDense.slice(
    0,
    Math.max(0, matureDense.length - PREVIEW_RENDER_POINTS),
  );

  const previewStart = Math.max(0, trail.path.length - PREVIEW_SOURCE_POINTS);
  const previewTrail = sliceTrail(trail, previewStart, trail.path.length);
  const previewDense = buildTrailBasePath(
    previewTrail,
    previewTrail.path.length,
  );
  const previewHead = previewDense.slice(
    Math.max(0, previewDense.length - PREVIEW_RENDER_POINTS),
  );

  const combined = dedupePoints([...sealedBody, ...previewHead]);
  const clipped = trail.fullHistory
    ? combined
    : dedupePoints(clipFromOldestEnd(combined, trailDistance));
  const clippedPreview = clipped.slice(
    Math.max(0, clipped.length - PREVIEW_RENDER_POINTS),
  );

  return {
    sealedBody: clipped.slice(0, clipped.length - clippedPreview.length),
    previewHead: clippedPreview,
    allPoints: clipped,
  };
}

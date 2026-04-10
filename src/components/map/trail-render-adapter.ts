import type { TrailEntry } from "@/hooks/use-trail-history";

import type { ElevatedPoint } from "./flight-layer-constants";

function isElevatedPointArray(
  value: TrailEntry | ElevatedPoint[],
): value is ElevatedPoint[] {
  return Array.isArray(value);
}

export function toPathLayerPoints(
  trailOrPoints: TrailEntry | ElevatedPoint[],
): [number, number, number][] {
  if (isElevatedPointArray(trailOrPoints)) {
    return trailOrPoints.map((point) => [point[0], point[1], point[2]]);
  }

  return trailOrPoints.path.map((point, index) => [
    point[0],
    point[1],
    trailOrPoints.altitudes[index] ?? 0,
  ]);
}

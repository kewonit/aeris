import type { TrailEnvelope, TrailSnapshot } from "@/lib/trails/types";
import { mergeSegments } from "@/lib/trails/geometry/merge-segments";

import type { ElevatedPoint } from "./flight-layer-constants";
import { buildTrailDisplayGeometry } from "./trail-display-geometry";

export type SelectedTrailRenderGeometry = {
  historicalBody: ElevatedPoint[];
  bridgeBody: ElevatedPoint[];
  liveContinuationBody: ElevatedPoint[];
  previewHead: ElevatedPoint[];
  allBodyPoints: ElevatedPoint[];
  allPoints: ElevatedPoint[];
};

function toTrailEntryFromSnapshots(
  icao24: string,
  samples: TrailSnapshot[],
  fullHistory: boolean,
) {
  return {
    icao24,
    path: samples.map((sample) => [sample.lng, sample.lat] as [number, number]),
    altitudes: samples.map((sample) => sample.altitude),
    timestamps: samples.map((sample) => sample.timestamp),
    baroAltitude: samples[samples.length - 1]?.altitude ?? null,
    fullHistory,
  };
}

function toElevatedPoints(samples: TrailSnapshot[]): ElevatedPoint[] {
  return samples.map((sample) => [
    sample.lng,
    sample.lat,
    Number.isFinite(sample.altitude) ? Math.max(0, sample.altitude ?? 0) : 0,
  ]);
}

function dedupeJoin(points: ElevatedPoint[]): ElevatedPoint[] {
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

export function buildSelectedTrailRenderGeometry(
  envelope: TrailEnvelope,
  trailDistance: number,
): SelectedTrailRenderGeometry {
  const merged = mergeSegments({
    liveTail: envelope.liveTail,
    historySegments: envelope.historySegments,
    referenceAltitude:
      envelope.liveTail[envelope.liveTail.length - 1]?.altitude ?? null,
  });

  const historicalBody =
    merged.historyBody.length >= 2
      ? buildTrailDisplayGeometry(
          toTrailEntryFromSnapshots(envelope.icao24, merged.historyBody, true),
          trailDistance,
        ).allPoints
      : toElevatedPoints(merged.historyBody);

  const bridgeBody = toElevatedPoints(merged.bridge);

  const liveGeometry =
    merged.liveContinuation.length >= 2
      ? buildTrailDisplayGeometry(
          toTrailEntryFromSnapshots(
            envelope.icao24,
            merged.liveContinuation,
            false,
          ),
          trailDistance,
        )
      : {
          sealedBody: toElevatedPoints(merged.liveContinuation),
          previewHead: [],
          allPoints: toElevatedPoints(merged.liveContinuation),
        };

  const allBodyPoints = dedupeJoin([
    ...historicalBody,
    ...bridgeBody,
    ...liveGeometry.sealedBody,
  ]);
  const allPoints = dedupeJoin([...allBodyPoints, ...liveGeometry.previewHead]);

  return {
    historicalBody,
    bridgeBody,
    liveContinuationBody: liveGeometry.sealedBody,
    previewHead: liveGeometry.previewHead,
    allBodyPoints,
    allPoints,
  };
}

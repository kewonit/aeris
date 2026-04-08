import type { TrailEnvelope, TrailSnapshot } from "@/lib/trails/types";

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

function flattenHistorySegments(envelope: TrailEnvelope): TrailSnapshot[] {
  return envelope.historySegments.flatMap((segment) => segment.samples);
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
  const historySamples = flattenHistorySegments(envelope);
  const historicalBody =
    historySamples.length >= 2
      ? buildTrailDisplayGeometry(
          toTrailEntryFromSnapshots(envelope.icao24, historySamples, true),
          historySamples.length,
        ).allPoints
      : [];

  const liveGeometry =
    envelope.liveTail.length >= 2
      ? buildTrailDisplayGeometry(
          toTrailEntryFromSnapshots(envelope.icao24, envelope.liveTail, false),
          trailDistance,
        )
      : { sealedBody: [], previewHead: [], allPoints: [] };

  const allBodyPoints = dedupeJoin([
    ...historicalBody,
    ...liveGeometry.sealedBody,
  ]);
  const allPoints = dedupeJoin([...allBodyPoints, ...liveGeometry.previewHead]);

  return {
    historicalBody,
    bridgeBody: [],
    liveContinuationBody: liveGeometry.sealedBody,
    previewHead: liveGeometry.previewHead,
    allBodyPoints,
    allPoints,
  };
}

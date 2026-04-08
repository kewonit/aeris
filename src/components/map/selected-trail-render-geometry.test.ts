import assert from "node:assert/strict";
import test from "node:test";

import type {
  TrailEnvelope,
  TrailSegment,
  TrailSnapshot,
} from "@/lib/trails/types";

import { buildTrailDisplayGeometry } from "./trail-display-geometry";
import { buildSelectedTrailRenderGeometry } from "./selected-trail-render-geometry";

function makeRecentArcSamples(): TrailSnapshot[] {
  const centerLng = 8.0;
  const centerLat = 50.0;
  const radius = 0.08;
  const start = -Math.PI / 2;
  const end = 0;

  return Array.from({ length: 18 }, (_, index) => {
    const t = index / 17;
    const angle = start + (end - start) * t;

    return {
      source: "live",
      timestamp: 1_000 + index,
      lng: centerLng + Math.cos(angle) * radius,
      lat: centerLat + Math.sin(angle) * radius,
      altitude: 10_000 + index * 20,
      track: 90,
      groundSpeed: 220,
      quality: "authoritative-live",
      onGround: false,
    } satisfies TrailSnapshot;
  });
}

function makeHistoryPrefix(join: TrailSnapshot): TrailSegment {
  const startLng = 7.2;
  const startLat = 49.2;
  const samples = Array.from({ length: 140 }, (_, index) => {
    const t = index / 139;

    return {
      source: "adsb-fi",
      timestamp: index,
      lng: startLng + (join.lng - startLng) * t,
      lat: startLat + (join.lat - startLat) * t,
      altitude: 9_500 + index * 2,
      track: 45,
      groundSpeed: 220,
      quality: "authoritative-trace",
      onGround: false,
    } satisfies TrailSnapshot;
  });

  return {
    kind: "historical",
    provider: "adsb-fi",
    samples,
  };
}

function samplePoint(points: [number, number, number][], t: number) {
  if (points.length === 0) {
    return [0, 0, 0] as const;
  }

  const scaled = t * (points.length - 1);
  const start = Math.floor(scaled);
  const end = Math.min(points.length - 1, start + 1);
  const fraction = scaled - start;
  const a = points[start];
  const b = points[end];

  return [
    a[0] + (b[0] - a[0]) * fraction,
    a[1] + (b[1] - a[1]) * fraction,
    a[2] + (b[2] - a[2]) * fraction,
  ] as const;
}

function maxPlanarDelta(
  left: [number, number, number][],
  right: [number, number, number][],
): number {
  let maxDelta = 0;

  for (let step = 0; step <= 100; step += 1) {
    const t = step / 100;
    const a = samplePoint(left, t);
    const b = samplePoint(right, t);
    maxDelta = Math.max(maxDelta, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }

  return maxDelta;
}

test("selected live continuation matches the active trail for the same live samples even with a long historical prefix", () => {
  const liveTail = makeRecentArcSamples();
  const active = buildTrailDisplayGeometry(
    {
      icao24: "live01",
      path: liveTail.map((sample) => [sample.lng, sample.lat]),
      altitudes: liveTail.map((sample) => sample.altitude),
      timestamps: liveTail.map((sample) => sample.timestamp),
      baroAltitude: liveTail[liveTail.length - 1].altitude,
    },
    80,
  );

  const envelope: TrailEnvelope = {
    icao24: "hist01",
    provider: "adsb-fi",
    outcome: "full-history",
    selectionGeneration: 1,
    liveRevision: 1,
    historyRevision: 1,
    lastSeenAt: 1,
    liveTail,
    historySegments: [makeHistoryPrefix(liveTail[0])],
    entry: null,
  };

  const selected = buildSelectedTrailRenderGeometry(envelope, 80);

  assert.ok(selected.liveContinuationBody.length > 0);
  assert.ok(
    maxPlanarDelta(active.sealedBody, selected.liveContinuationBody) < 1e-6,
  );
  assert.ok(maxPlanarDelta(active.previewHead, selected.previewHead) < 1e-6);
});

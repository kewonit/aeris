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

function planarDistance(
  point: [number, number, number],
  target: TrailSnapshot,
): number {
  return Math.hypot(point[0] - target.lng, point[1] - target.lat);
}

function planarBounds(points: [number, number, number][]) {
  return {
    width:
      Math.max(...points.map((point) => point[0])) -
      Math.min(...points.map((point) => point[0])),
    height:
      Math.max(...points.map((point) => point[1])) -
      Math.min(...points.map((point) => point[1])),
  };
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

test("selected live continuation snaps to the canonical handoff when the history tail is near the live head", () => {
  const liveTail = makeRecentArcSamples();
  const historyTail: TrailSnapshot = {
    ...liveTail[0],
    source: "adsb-fi",
    timestamp: 999,
    lng: liveTail[0].lng - 0.04,
    lat: liveTail[0].lat + 0.002,
    quality: "authoritative-trace",
  };

  const envelope: TrailEnvelope = {
    icao24: "hist01",
    provider: "adsb-fi",
    outcome: "full-history",
    selectionGeneration: 1,
    liveRevision: 1,
    historyRevision: 1,
    lastSeenAt: 1,
    liveTail,
    historySegments: [makeHistoryPrefix(historyTail)],
    entry: null,
  };

  const selected = buildSelectedTrailRenderGeometry(envelope, 80);

  assert.ok(selected.liveContinuationBody.length > 0);
  assert.ok(
    planarDistance(selected.liveContinuationBody[0], historyTail) < 1e-6,
  );
});

test("selected live continuation matches active geometry for a sparse holding-pattern live tail", () => {
  const liveTail = [
    {
      source: "live",
      timestamp: 1_000,
      lng: 72.98,
      lat: 19.1,
      altitude: 5_500,
      track: 0,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
    {
      source: "live",
      timestamp: 61_000,
      lng: 72.94,
      lat: 19.1,
      altitude: 5_550,
      track: 180,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
    {
      source: "live",
      timestamp: 121_000,
      lng: 72.91,
      lat: 19.065,
      altitude: 5_620,
      track: 225,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
  ] satisfies TrailSnapshot[];

  const active = buildTrailDisplayGeometry(
    {
      icao24: "hold01",
      path: liveTail.map((sample) => [sample.lng, sample.lat]),
      altitudes: liveTail.map((sample) => sample.altitude),
      timestamps: liveTail.map((sample) => sample.timestamp),
      baroAltitude: liveTail[liveTail.length - 1].altitude,
    },
    80,
  );

  const envelope: TrailEnvelope = {
    icao24: "hold01",
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

  assert.ok(
    maxPlanarDelta(active.sealedBody, selected.liveContinuationBody) < 1e-6,
  );
  assert.ok(maxPlanarDelta(active.previewHead, selected.previewHead) < 1e-6);
});

test("selected sparse holding-pattern continuation preserves the recent hold footprint when history is prefixed", () => {
  const liveTail = [
    {
      source: "live",
      timestamp: 1_000,
      lng: 72.98,
      lat: 19.18,
      altitude: 5_500,
      track: 20,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
    {
      source: "live",
      timestamp: 61_000,
      lng: 73.05,
      lat: 19.08,
      altitude: 5_520,
      track: 150,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
    {
      source: "live",
      timestamp: 121_000,
      lng: 73.0,
      lat: 18.92,
      altitude: 5_540,
      track: 225,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
    {
      source: "live",
      timestamp: 181_000,
      lng: 72.89,
      lat: 19.0,
      altitude: 5_560,
      track: 320,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
    {
      source: "live",
      timestamp: 241_000,
      lng: 72.93,
      lat: 19.17,
      altitude: 5_580,
      track: 20,
      groundSpeed: 115,
      quality: "authoritative-live",
      onGround: false,
    },
  ] satisfies TrailSnapshot[];

  const envelope: TrailEnvelope = {
    icao24: "hold-selected01",
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
  const bounds = planarBounds(selected.allPoints);

  assert.ok(bounds.width > 0.12);
  assert.ok(bounds.height > 0.18);
});

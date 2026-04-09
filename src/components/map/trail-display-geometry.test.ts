import assert from "node:assert/strict";
import test from "node:test";

import type { TrailEntry } from "@/hooks/use-trail-history";

import { buildTrailDisplayGeometry } from "./trail-display-geometry";

const APPROACH_TRAIL_SEGMENTS = {
  initialApproachPoints: 12,
  olderLoopPoints: 10,
  recentStraightInPoints: 18,
} as const;

function makeArcTrail(count: number, fullHistory = false): TrailEntry {
  const centerLng = 8.0;
  const centerLat = 50.0;
  const radius = 0.08;
  const start = -Math.PI / 2;
  const end = 0;
  const totalSamples = 24;
  const path: [number, number][] = [];
  const altitudes: number[] = [];
  const timestamps: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const t = index / (totalSamples - 1);
    const angle = start + (end - start) * t;
    path.push([
      centerLng + Math.cos(angle) * radius,
      centerLat + Math.sin(angle) * radius,
    ]);
    altitudes.push(10_000 + index * 20);
    timestamps.push(index);
  }

  return {
    icao24: fullHistory ? "hist01" : "arc01",
    path,
    altitudes,
    timestamps,
    baroAltitude: altitudes[altitudes.length - 1],
    fullHistory,
  };
}

function makeApproachTrailWithOlderLoop(): TrailEntry {
  const path: [number, number][] = [];
  const altitudes: number[] = [];
  const timestamps: number[] = [];

  const push = (lng: number, lat: number) => {
    path.push([lng, lat]);
    altitudes.push(1000 + path.length * 10);
    timestamps.push(path.length);
  };

  for (
    let index = 0;
    index < APPROACH_TRAIL_SEGMENTS.initialApproachPoints;
    index += 1
  ) {
    push(73.25 - index * 0.015, 19.05 + index * 0.012);
  }

  for (
    let index = 0;
    index < APPROACH_TRAIL_SEGMENTS.olderLoopPoints;
    index += 1
  ) {
    push(73.07 + index * 0.01, 19.19 + Math.sin((index / 9) * Math.PI) * 0.08);
  }

  for (
    let index = 0;
    index < APPROACH_TRAIL_SEGMENTS.recentStraightInPoints;
    index += 1
  ) {
    push(73.14 - index * 0.012, 19.14 - index * 0.0015);
  }

  return {
    icao24: "recent-window01",
    path,
    altitudes,
    timestamps,
    baroAltitude: altitudes[altitudes.length - 1],
  };
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

function worstLocalProjectionDrop(points: [number, number, number][]): number {
  let worst = 0;

  for (let index = 1; index < points.length - 2; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const following = points[index + 2];
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

    worst = Math.min(worst, nextProjection - currentProjection);
  }

  return worst;
}

function heading(a: [number, number, number], b: [number, number, number]) {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

function joinHeadingDeltaDeg(geometry: {
  sealedBody: [number, number, number][];
  allPoints: [number, number, number][];
}): number {
  const join = geometry.sealedBody.length;
  if (join < 2 || join + 1 >= geometry.allPoints.length) {
    return 0;
  }

  const before = heading(
    geometry.allPoints[join - 2],
    geometry.allPoints[join - 1],
  );
  const after = heading(geometry.allPoints[join], geometry.allPoints[join + 1]);
  const delta = Math.abs(
    ((after - before + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
  );

  return (delta * 180) / Math.PI;
}

test("buildTrailDisplayGeometry keeps the sealed prefix fixed across a live append", () => {
  const first = buildTrailDisplayGeometry(makeArcTrail(12), 80);
  const second = buildTrailDisplayGeometry(makeArcTrail(13), 80);

  assert.deepStrictEqual(
    second.sealedBody.slice(0, first.sealedBody.length),
    first.sealedBody,
  );
});

test("buildTrailDisplayGeometry does not create a hard angle where the active sealed body meets the preview head", () => {
  const geometry = buildTrailDisplayGeometry(
    {
      icao24: "dogleg01",
      path: [
        [72.8, 19.0],
        [72.84, 19.0],
        [72.88, 19.0],
        [72.92, 19.03],
        [72.95, 19.08],
        [72.97, 19.14],
        [72.98, 19.2],
      ],
      altitudes: [1000, 1010, 1020, 1030, 1040, 1050, 1060],
      timestamps: [1, 2, 3, 4, 5, 6, 7],
      baroAltitude: 1060,
    },
    80,
  );

  assert.ok(joinHeadingDeltaDeg(geometry) < 10);
});

test("buildTrailDisplayGeometry does not create a hard angle where the selected sealed body meets the preview head", () => {
  const geometry = buildTrailDisplayGeometry(
    {
      icao24: "histHook01",
      path: [
        [72.8, 19.0],
        [72.88, 19.0],
        [72.96, 19.06],
        [73.0, 19.16],
        [72.98, 19.26],
        [72.9, 19.34],
        [72.8, 19.38],
      ],
      altitudes: [1000, 1010, 1020, 1030, 1040, 1050, 1060],
      timestamps: [1, 2, 3, 4, 5, 6, 7],
      baroAltitude: 1060,
      fullHistory: true,
    },
    80,
  );

  assert.ok(joinHeadingDeltaDeg(geometry) < 10);
});

test("buildTrailDisplayGeometry bounds the mutable preview head", () => {
  const geometry = buildTrailDisplayGeometry(makeArcTrail(18), 80);

  assert.ok(geometry.previewHead.length <= 21);
  assert.ok(geometry.previewHead.length > 0);
  assert.deepStrictEqual(
    geometry.allPoints.slice(-geometry.previewHead.length),
    geometry.previewHead,
  );
});

test("buildTrailDisplayGeometry rebuilds active trails from the recent raw window when trailDistance shortens", () => {
  const trailDistance = 12;
  const fullTrail = makeArcTrail(18);
  const recentWindowTrail: TrailEntry = {
    ...fullTrail,
    path: fullTrail.path.slice(-trailDistance),
    altitudes: fullTrail.altitudes.slice(-trailDistance),
    timestamps: fullTrail.timestamps.slice(-trailDistance),
    baroAltitude: fullTrail.altitudes[fullTrail.altitudes.length - 1],
  };

  const current = buildTrailDisplayGeometry(fullTrail, trailDistance);
  const expectedRecent = buildTrailDisplayGeometry(
    recentWindowTrail,
    trailDistance,
  );

  assert.deepStrictEqual(current, expectedRecent);
});

test("buildTrailDisplayGeometry ignores older off-window live loops when trailDistance is shorter than the live path", () => {
  const trailDistance = APPROACH_TRAIL_SEGMENTS.recentStraightInPoints;
  const fullTrail = makeApproachTrailWithOlderLoop();
  const slicedRecentTrail: TrailEntry = {
    ...fullTrail,
    path: fullTrail.path.slice(-trailDistance),
    altitudes: fullTrail.altitudes.slice(-trailDistance),
    timestamps: fullTrail.timestamps.slice(-trailDistance),
    baroAltitude: fullTrail.altitudes[fullTrail.altitudes.length - 1],
  };

  const current = buildTrailDisplayGeometry(fullTrail, trailDistance);
  const expectedRecent = buildTrailDisplayGeometry(
    slicedRecentTrail,
    trailDistance,
  );

  assert.deepStrictEqual(current.allPoints, expectedRecent.allPoints);
});

test("buildTrailDisplayGeometry keeps full-history trails untrimmed by the live trail distance setting", () => {
  const wide = buildTrailDisplayGeometry(makeArcTrail(18, true), 80);
  const narrow = buildTrailDisplayGeometry(makeArcTrail(18, true), 12);

  assert.deepStrictEqual(narrow.allPoints, wide.allPoints);
});

test("buildTrailDisplayGeometry removes local backtracks that would render as loops or cusps", () => {
  const geometry = buildTrailDisplayGeometry(
    {
      icao24: "loop01",
      path: [
        [72.8, 19.0],
        [72.84, 19.0],
        [72.846, 18.92],
        [72.852, 18.92],
        [72.858, 19.02],
        [72.92, 19.01],
      ],
      altitudes: [1000, 1000, 1000, 1000, 1000, 1000],
      timestamps: [1, 2, 3, 4, 5, 6],
      baroAltitude: 1000,
    },
    80,
  );

  assert.ok(worstLocalProjectionDrop(geometry.allPoints) > -0.01);
});

test("buildTrailDisplayGeometry preserves a sparse hold while still removing a tiny interior cusp", () => {
  const geometry = buildTrailDisplayGeometry(
    {
      icao24: "hold-cusp01",
      path: [
        [72.98, 19.18],
        [73.05, 19.08],
        [73.0, 18.92],
        [73.004, 18.908],
        [72.997, 18.909],
        [72.89, 19.0],
        [72.93, 19.17],
      ],
      altitudes: [5_000, 5_010, 5_020, 5_025, 5_030, 5_040, 5_050],
      timestamps: [0, 60_000, 120_000, 150_000, 180_000, 240_000, 300_000],
      baroAltitude: 5_050,
      fullHistory: true,
    },
    80,
  );

  const bounds = planarBounds(geometry.allPoints);

  assert.ok(bounds.width > 0.12);
  assert.ok(bounds.height > 0.18);
  assert.ok(worstLocalProjectionDrop(geometry.allPoints) > -0.01);
});

test("buildTrailDisplayGeometry preserves a sustained sparse turnback instead of collapsing it into a chord", () => {
  const geometry = buildTrailDisplayGeometry(
    {
      icao24: "hold-geometry01",
      path: [
        [72.98, 19.18],
        [73.05, 19.08],
        [73.0, 18.92],
        [72.89, 19.0],
        [72.93, 19.17],
      ],
      altitudes: [5_000, 5_010, 5_020, 5_030, 5_040],
      timestamps: [0, 60_000, 120_000, 180_000, 240_000],
      baroAltitude: 5_040,
      fullHistory: true,
    },
    80,
  );

  const bounds = planarBounds(geometry.allPoints);

  assert.ok(bounds.width > 0.12);
  assert.ok(bounds.height > 0.18);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { TrailEntry } from "@/hooks/use-trail-history";

import { buildTrailDisplayGeometry } from "./trail-display-geometry";

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
    const t = totalSamples === 1 ? 0 : index / (totalSamples - 1);
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

test("buildTrailDisplayGeometry keeps the sealed prefix fixed across a live append", () => {
  const first = buildTrailDisplayGeometry(makeArcTrail(12), 80);
  const second = buildTrailDisplayGeometry(makeArcTrail(13), 80);

  assert.deepStrictEqual(
    second.sealedBody.slice(0, first.sealedBody.length),
    first.sealedBody,
  );
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

test("buildTrailDisplayGeometry clips active trails from the oldest end only", () => {
  const full = buildTrailDisplayGeometry(makeArcTrail(18), 80);
  const clipped = buildTrailDisplayGeometry(makeArcTrail(18), 12);

  assert.ok(clipped.allPoints.length < full.allPoints.length);
  assert.deepStrictEqual(
    clipped.allPoints,
    full.allPoints.slice(full.allPoints.length - clipped.allPoints.length),
  );
});

test("buildTrailDisplayGeometry keeps full-history trails untrimmed by the live trail distance setting", () => {
  const wide = buildTrailDisplayGeometry(makeArcTrail(18, true), 80);
  const narrow = buildTrailDisplayGeometry(makeArcTrail(18, true), 12);

  assert.deepStrictEqual(narrow.allPoints, wide.allPoints);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  catmullRomRespline3D,
  catmullRomSpline3D,
  type ElevatedPoint,
} from "./trail-spline";

function assertPointNear(
  actual: ElevatedPoint,
  expected: ElevatedPoint,
  tolerance = 1e-12,
): void {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index++) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `point[${index}] expected ${expected[index]} but got ${actual[index]}`,
    );
  }
}

function horizontalMaxDifference(
  first: ElevatedPoint[],
  second: ElevatedPoint[],
): number {
  assert.equal(first.length, second.length);

  let maxDifference = 0;
  for (let index = 0; index < first.length; index++) {
    maxDifference = Math.max(
      maxDifference,
      Math.abs(first[index][0] - second[index][0]),
      Math.abs(first[index][1] - second[index][1]),
    );
  }

  return maxDifference;
}

function assertIncludesWaypointsInOrder(
  result: ElevatedPoint[],
  waypoints: ElevatedPoint[],
): void {
  let searchStart = 0;

  for (const waypoint of waypoints) {
    const foundIndex = result.findIndex(
      (point, index) =>
        index >= searchStart &&
        point[0] === waypoint[0] &&
        point[1] === waypoint[1] &&
        point[2] === waypoint[2],
    );

    assert.notEqual(foundIndex, -1, `missing waypoint ${waypoint.join(",")}`);
    searchStart = foundIndex + 1;
  }
}

test("catmullRomSpline3D falls back to linear interpolation for two points", () => {
  const start: ElevatedPoint = [10, 20, 1_000];
  const end: ElevatedPoint = [18, 28, 9_000];

  const result = catmullRomSpline3D([start, end]);

  assert.equal(result.length, 9);
  assertPointNear(result[0], start);
  assertPointNear(result[result.length - 1], end);

  for (let index = 0; index < result.length; index++) {
    const t = index / (result.length - 1);
    assertPointNear(result[index], [10 + 8 * t, 20 + 8 * t, 1_000 + 8_000 * t]);
  }
});

test("catmullRomSpline3D preserves original waypoints in order", () => {
  const waypoints: ElevatedPoint[] = [
    [-0.03, 0.01, 4_000],
    [-0.01, 0.02, 6_000],
    [0.03, 0.025, 8_000],
    [0.05, 0.04, 10_000],
  ];

  const result = catmullRomSpline3D(waypoints, 4, 4);

  assertIncludesWaypointsInOrder(result, waypoints);
});

test("catmullRomSpline3D produces finite output with duplicate and near-duplicate points", () => {
  const waypoints: ElevatedPoint[] = [
    [0, 0, 1_000],
    [0, 0, 1_200],
    [0.0000001, 0.0000001, 1_400],
    [0.02, 0.01, Number.NaN],
    [0.04, 0.02, 3_000],
  ];

  const result = catmullRomSpline3D(waypoints, 4, 4);

  assert.ok(result.length >= 2);
  for (const point of result) {
    assert.ok(
      point.every(Number.isFinite),
      `expected finite point, got ${point.join(",")}`,
    );
  }
});

test("catmullRomSpline3D keeps straight horizontal paths monotonic", () => {
  const waypoints: ElevatedPoint[] = [
    [0, 0, 1_000],
    [0.02, 0.02, 2_000],
    [0.04, 0.04, 3_000],
    [0.06, 0.06, 4_000],
  ];

  const result = catmullRomSpline3D(waypoints, 6, 6);

  assertPointNear(result[0], waypoints[0]);
  assertPointNear(result[result.length - 1], waypoints[waypoints.length - 1]);

  for (let index = 1; index < result.length; index++) {
    assert.ok(
      result[index][0] >= result[index - 1][0],
      `longitude regressed at ${index}`,
    );
    assert.ok(
      result[index][1] >= result[index - 1][1],
      `latitude regressed at ${index}`,
    );
  }
});

test("catmullRomSpline3D keeps horizontal geometry independent from altitude spikes", () => {
  const xy: Array<[number, number]> = [
    [0, 0],
    [0.02, 0.01],
    [0.04, 0.015],
    [0.06, 0.04],
  ];
  const flat = catmullRomSpline3D(
    xy.map(([lng, lat]) => [lng, lat, 0] as ElevatedPoint),
    6,
    6,
  );
  const altitudeSpike = catmullRomSpline3D(
    xy.map(
      ([lng, lat], index) =>
        [lng, lat, [0, 40_000, -40_000, 0][index]] as ElevatedPoint,
    ),
    6,
    6,
  );

  const maxDifference = horizontalMaxDifference(flat, altitudeSpike);

  assert.ok(
    maxDifference <= 1e-12,
    `expected horizontal max diff <= 1e-12, got ${maxDifference}`,
  );
});

test("catmullRomRespline3D keeps horizontal geometry independent from altitude spikes", () => {
  const anchorBefore: ElevatedPoint = [-0.02, -0.01, 0];
  const anchorAfter: ElevatedPoint = [0.08, 0.055, 0];
  const flatWindow: ElevatedPoint[] = [
    [0, 0, 0],
    [0.02, 0.01, 0],
    [0.04, 0.015, 0],
    [0.06, 0.04, 0],
  ];
  const spikeWindow: ElevatedPoint[] = [
    [0, 0, 0],
    [0.02, 0.01, 35_000],
    [0.04, 0.015, -35_000],
    [0.06, 0.04, 0],
  ];

  const flat = catmullRomRespline3D(
    anchorBefore,
    flatWindow,
    anchorAfter,
    6,
    6,
  );
  const altitudeSpike = catmullRomRespline3D(
    anchorBefore,
    spikeWindow,
    anchorAfter,
    6,
    6,
  );

  const maxDifference = horizontalMaxDifference(flat, altitudeSpike);

  assert.ok(
    maxDifference <= 1e-12,
    `expected horizontal max diff <= 1e-12, got ${maxDifference}`,
  );
});

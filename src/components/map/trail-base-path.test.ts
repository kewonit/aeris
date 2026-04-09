import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import { buildTrailBasePath, buildVisibleTrailPoints } from "./trail-base-path";

function maxHeadingDeltaDeg(points: [number, number, number][]): number {
  let maxDelta = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const before = Math.atan2(current[1] - prev[1], current[0] - prev[0]);
    const after = Math.atan2(next[1] - current[1], next[0] - current[0]);
    let delta = after - before;

    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;

    maxDelta = Math.max(maxDelta, Math.abs(delta) * (180 / Math.PI));
  }

  return maxDelta;
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

function makeSparseHoldTrail(fullHistory: boolean) {
  const path: [number, number][] = [
    [72.98, 19.18],
    [73.05, 19.08],
    [73.0, 18.92],
    [72.89, 19.0],
    [72.93, 19.17],
  ];
  const altitudes = path.map((_, index) => 5_000 + index * 10);
  const timestamps = path.map((_, index) => index * 60_000);

  return {
    icao24: fullHistory ? "hold-hist" : "hold-live",
    path,
    altitudes,
    timestamps,
    baroAltitude: altitudes[altitudes.length - 1],
    fullHistory,
  };
}

test("fullHistory base path is densified through the shared smoothing path", () => {
  const path: [number, number][] = [
    [-73.0, 40.0],
    [-72.95, 40.03],
    [-72.89, 40.09],
    [-72.82, 40.17],
    [-72.74, 40.28],
  ];

  const basePath = buildTrailBasePath(
    {
      icao24: "abc123",
      path,
      altitudes: [10200, 10350, 10500, 10650, 10800],
      timestamps: [1, 2, 3, 4, 5],
      baroAltitude: 10800,
      fullHistory: true,
    },
    80,
  );

  assert.ok(basePath.length > path.length);
  assert.deepStrictEqual(basePath[0]?.slice(0, 2), path[0]);
  assert.deepStrictEqual(
    basePath[basePath.length - 1]?.slice(0, 2),
    path[path.length - 1],
  );
});

test("buildVisibleTrailPoints keeps the fixed trail body unchanged while aircraft interpolates", () => {
  const trail = {
    icao24: "abc123",
    path: [
      [8.0, 50.0],
      [8.05, 50.0],
      [8.1, 50.0],
    ] as [number, number][],
    altitudes: [1000, 1020, 1040],
    timestamps: [1, 2, 3],
    baroAltitude: 1040,
  };

  const basePath = buildTrailBasePath(trail, 80);

  const first = buildVisibleTrailPoints(
    trail,
    {
      icao24: "abc123",
      longitude: 8.12,
      latitude: 50.0,
      baroAltitude: 1045,
    } as FlightState,
    80,
    basePath,
  );

  const second = buildVisibleTrailPoints(
    trail,
    {
      icao24: "abc123",
      longitude: 8.15,
      latitude: 50.0,
      baroAltitude: 1050,
    } as FlightState,
    80,
    basePath,
  );

  assert.deepStrictEqual(first, basePath);
  assert.deepStrictEqual(second, basePath);
});

test("buildTrailBasePath removes short alternating needle kinks from active trails", () => {
  const basePath = buildTrailBasePath(
    {
      icao24: "needle01",
      path: [
        [72.8, 19.0],
        [72.84, 19.0],
        [72.852, 19.012],
        [72.848, 18.992],
        [72.9, 19.0],
      ],
      altitudes: [1000, 1000, 1000, 1000, 1000],
      timestamps: [1, 2, 3, 4, 5],
      baroAltitude: 1000,
    },
    80,
  );

  const latitudes = basePath.map((point) => point[1]);
  const latRange = Math.max(...latitudes) - Math.min(...latitudes);

  assert.ok(latRange < 0.002);
});

test("buildTrailBasePath keeps a real active turn instead of flattening it as a needle", () => {
  const basePath = buildTrailBasePath(
    {
      icao24: "turn01",
      path: [
        [72.8, 19.0],
        [72.82, 19.0],
        [72.84, 19.004],
        [72.86, 19.012],
        [72.88, 19.024],
      ],
      altitudes: [1000, 1010, 1020, 1030, 1040],
      timestamps: [1, 2, 3, 4, 5],
      baroAltitude: 1040,
    },
    80,
  );

  const latitudes = basePath.map((point) => point[1]);
  const latRange = Math.max(...latitudes) - Math.min(...latitudes);

  assert.ok(latRange > 0.01);
});

test("buildTrailBasePath removes large isolated excursions from full-history trails", () => {
  const basePath = buildTrailBasePath(
    {
      icao24: "histSpike01",
      path: [
        [72.8, 19.0],
        [72.84, 19.002],
        [73.42, 18.08],
        [72.88, 19.018],
        [72.92, 19.024],
      ],
      altitudes: [1000, 1010, 1020, 1030, 1040],
      timestamps: [1, 2, 3, 4, 5],
      baroAltitude: 1040,
      fullHistory: true,
    },
    80,
  );

  const latitudes = basePath.map((point) => point[1]);
  const longitudes = basePath.map((point) => point[0]);

  assert.ok(Math.min(...latitudes) > 18.9);
  assert.ok(Math.max(...longitudes) < 73.1);
});

test("buildTrailBasePath does not preserve a stale rectangular detour in selected full-history mode", () => {
  const basePath = buildTrailBasePath(
    {
      icao24: "histRect01",
      path: [
        [72.87, 19.08],
        [73.36, 19.15],
        [73.28, 19.42],
        [72.96, 19.34],
        [72.92, 19.17],
      ],
      altitudes: [4000, 5500, 7000, 6800, 4200],
      timestamps: [1, 2, 3, 4, 5],
      baroAltitude: 4200,
      fullHistory: true,
    },
    80,
  );

  assert.ok(basePath.length > 0);
  assert.ok(Math.max(...basePath.map((point) => point[1])) < 19.4);
});

test("buildTrailBasePath shortens a sparse alternating zig-zag before display smoothing", () => {
  const basePath = buildTrailBasePath(
    {
      icao24: "histZig01",
      path: [
        [72.8, 19.0],
        [72.88, 19.07],
        [72.95, 19.02],
        [73.02, 19.09],
        [73.09, 19.04],
      ],
      altitudes: [1000, 1010, 1020, 1030, 1040],
      timestamps: [1, 2, 3, 4, 5],
      baroAltitude: 1040,
      fullHistory: true,
    },
    80,
  );

  assert.ok(maxHeadingDeltaDeg(basePath) < 12);
});

test("buildTrailBasePath preserves sparse hold footprint in active mode", () => {
  const basePath = buildTrailBasePath(makeSparseHoldTrail(false), 80);
  const bounds = planarBounds(basePath);

  assert.ok(bounds.width > 0.12);
  assert.ok(bounds.height > 0.18);
});

test("buildTrailBasePath preserves sparse hold footprint in full-history mode", () => {
  const basePath = buildTrailBasePath(makeSparseHoldTrail(true), 80);
  const bounds = planarBounds(basePath);

  assert.ok(bounds.width > 0.12);
  assert.ok(bounds.height > 0.18);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  buildTrailBasePath,
  buildVisibleTrailPoints,
} from "./trail-base-path.ts";

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

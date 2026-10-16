import assert from "node:assert/strict";
import test from "node:test";

import { projectLngLatElevationPixelDelta } from "./camera-controller-utils";

test("elevation projection measures from MapLibre's padded visual center", () => {
  const map = {
    transform: {
      centerPoint: { x: 978, y: 400 },
      locationToScreenPoint: () => ({ x: 1_000, y: 370 }),
    },
    getCanvas: () => ({ clientWidth: 1_512, clientHeight: 800 }),
    project: () => ({ x: 1_000, y: 370 }),
  };

  const delta = projectLngLatElevationPixelDelta(
    map as never,
    -122.4,
    37.8,
    9_000,
  );

  assert.deepEqual(delta, { dx: 22, dy: -30 });
});

test("elevation projection falls back to the canvas center without padding", () => {
  const map = {
    transform: {
      locationToScreenPoint: () => ({ x: 800, y: 450 }),
    },
    getCanvas: () => ({ clientWidth: 1_512, clientHeight: 800 }),
    project: () => ({ x: 800, y: 450 }),
  };

  const delta = projectLngLatElevationPixelDelta(
    map as never,
    -122.4,
    37.8,
    0,
  );

  assert.deepEqual(delta, { dx: 44, dy: 50 });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_FRAME_INTERVAL_MS,
  FPV_FRAME_INTERVAL_MS,
  OVERVIEW_FRAME_INTERVAL_MS,
  frameIntervalMs,
  isFrameDue,
} from "./frame-rate";

test("frame gate renders the first frame immediately", () => {
  assert.equal(isFrameDue(0, 1), true);
});

test("frame gate caps work on 60Hz and 120Hz displays", () => {
  assert.equal(isFrameDue(100, 100 + 1000 / 120), false);
  assert.equal(isFrameDue(100, 100 + 1000 / 60), false);
  assert.equal(isFrameDue(100, 100 + ACTIVE_FRAME_INTERVAL_MS), true);
});

test("overview rendering uses the lower power 20fps cadence", () => {
  assert.equal(isFrameDue(100, 100 + 1000 / 30, OVERVIEW_FRAME_INTERVAL_MS), false);
  assert.equal(isFrameDue(100, 100 + 50, OVERVIEW_FRAME_INTERVAL_MS), true);
});

test("a moving camera rebuilds at 60fps on 60Hz and 120Hz displays", () => {
  const interval = frameIntervalMs({ fpv: false, cameraMoving: true });

  assert.equal(isFrameDue(100, 100 + 1000 / 60, interval), true);
  assert.equal(isFrameDue(100, 100 + 1000 / 120, interval), false);
  assert.equal(isFrameDue(100, 100 + 2000 / 120, interval), true);
});

test("a still camera falls back to the overview cadence", () => {
  assert.equal(
    frameIntervalMs({ fpv: false, cameraMoving: false }),
    OVERVIEW_FRAME_INTERVAL_MS,
  );
});

test("first person view redraws every third frame at 120Hz and every other at 60Hz", () => {
  const interval = frameIntervalMs({ fpv: true, cameraMoving: true });
  assert.equal(interval, FPV_FRAME_INTERVAL_MS);

  assert.equal(isFrameDue(100, 100 + 2000 / 120, interval), false);
  assert.equal(isFrameDue(100, 100 + 3000 / 120, interval), true);
  assert.equal(isFrameDue(100, 100 + 1000 / 60, interval), false);
  assert.equal(isFrameDue(100, 100 + 2000 / 60, interval), true);
});

test("frame gate recovers safely from invalid clocks", () => {
  assert.equal(isFrameDue(Number.NaN, 100), true);
  assert.equal(isFrameDue(100, Number.POSITIVE_INFINITY), true);
});

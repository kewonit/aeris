import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_FRAME_INTERVAL_MS,
  FPV_FRAME_INTERVAL_MS,
  MIN_OVERVIEW_FRAME_RATE,
  OVERVIEW_FRAME_INTERVAL_MS,
  frameIntervalMs,
  isFrameDue,
  overviewFrameIntervalMs,
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

test("the overview slows down when aircraft barely move on screen", () => {
  // An airliner at city zoom: about 2.4 px a second, so 8 redraws a second
  // move it 0.3 px each.
  assert.equal(Math.round(1000 / overviewFrameIntervalMs(2.4)), 8);
  // Zoomed in to an airport it is back at the full rate...
  assert.equal(overviewFrameIntervalMs(100), OVERVIEW_FRAME_INTERVAL_MS);
  // ...and with everything parked, or nothing known, at the floor.
  assert.equal(overviewFrameIntervalMs(0), 1000 / MIN_OVERVIEW_FRAME_RATE);
  assert.equal(overviewFrameIntervalMs(NaN), 1000 / MIN_OVERVIEW_FRAME_RATE);

  assert.equal(
    frameIntervalMs({ fpv: false, cameraMoving: false, maxPixelsPerSecond: 1 }),
    1000 / MIN_OVERVIEW_FRAME_RATE,
  );
  // A fading selection needs smooth frames whatever the aircraft do.
  assert.equal(
    frameIntervalMs({
      fpv: false,
      cameraMoving: false,
      fading: true,
      maxPixelsPerSecond: 1,
    }),
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

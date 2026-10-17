import assert from "node:assert/strict";
import test from "node:test";

import {
  fpvCameraPitch,
  FPV_LEVEL_PITCH,
  horizonScreenY,
  MAX_FPV_PITCH,
} from "./fpv-scenery";

test("level flight looks just below the horizon, and the view nods with the nose", () => {
  // In level flight the nose rides 3° above the flight path.
  assert.equal(fpvCameraPitch(3, false), FPV_LEVEL_PITCH);
  assert.ok(fpvCameraPitch(8, false) > FPV_LEVEL_PITCH);
  assert.ok(fpvCameraPitch(0, false) < FPV_LEVEL_PITCH);
  // A steep climb or dive is held within limits deck stays aligned to.
  assert.equal(fpvCameraPitch(15, false), MAX_FPV_PITCH);
  assert.equal(fpvCameraPitch(-5, false), 80);
  assert.equal(fpvCameraPitch(0, true), FPV_LEVEL_PITCH);
});

test("the horizon line sits where the camera's pitch puts it", () => {
  // Looking straight at the horizon puts it mid-screen...
  assert.ok(Math.abs(horizonScreenY(800, 36.87, 90) - 400) < 1e-9);
  // ...and looking down by half the field of view puts it at the top.
  assert.ok(Math.abs(horizonScreenY(800, 36.87, 90 - 18.435)) < 0.5);
});

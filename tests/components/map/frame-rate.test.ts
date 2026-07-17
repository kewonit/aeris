import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_FRAME_INTERVAL_MS,
  OVERVIEW_FRAME_INTERVAL_MS,
  isFrameDue,
} from "@/components/map/frame-rate";

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

test("frame gate recovers safely from invalid clocks", () => {
  assert.equal(isFrameDue(Number.NaN, 100), true);
  assert.equal(isFrameDue(100, Number.POSITIVE_INFINITY), true);
});

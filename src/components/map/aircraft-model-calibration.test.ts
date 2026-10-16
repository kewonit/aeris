import assert from "node:assert/strict";
import test from "node:test";

import {
  getAircraftModelCalibration,
} from "./aircraft-model-calibration";

test("logical model calibration exposes a distinct tail anchor for shared widebody meshes", () => {
  const a380 = getAircraftModelCalibration("a380");
  const widebody = getAircraftModelCalibration("widebody-4eng");

  assert.notEqual(a380.tailAnchorMeters, widebody.tailAnchorMeters);
});

test("narrowbody calibration preserves the established base roll", () => {
  const narrowbody = getAircraftModelCalibration("narrowbody");

  assert.equal(narrowbody.baseRoll, 90);
});

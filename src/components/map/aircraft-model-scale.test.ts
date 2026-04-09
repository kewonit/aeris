import assert from "node:assert/strict";
import test from "node:test";

import { getEffectiveModelScale } from "./aircraft-model-calibration";
import { aircraftSizeMultiplier } from "./aircraft-appearance";
import {
  BASE_3D_MODEL_SIZE,
  getAircraftModelZoomCompensation,
  getAircraftScenegraphSizeScale,
} from "./aircraft-model-size";
import { modelDisplayScale } from "./aircraft-model-mapping";

test("A380 scale stays larger than B737 scale", () => {
  assert.ok(modelDisplayScale("a380") > modelDisplayScale("b737"));
});

test("heavy fallback stays larger than narrowbody fallback", () => {
  const heavy = aircraftSizeMultiplier(null, 6);
  const narrowbody = aircraftSizeMultiplier(null, 4);

  assert.ok(heavy > narrowbody);
});

test("3D zoom compensation is neutral at the reference zoom", () => {
  assert.equal(getAircraftModelZoomCompensation(6), 1);
});

test("3D zoom compensation grows as the camera zooms out", () => {
  assert.equal(getAircraftModelZoomCompensation(5), 2);
});

test("3D zoom compensation safely ignores non-finite zoom values", () => {
  assert.equal(getAircraftModelZoomCompensation(Number.NaN), 1);
});

test("scenegraph size scale keeps A380 larger than narrowbody after zoom compensation", () => {
  assert.ok(
    getAircraftScenegraphSizeScale(modelDisplayScale("a380"), 5) >
      getAircraftScenegraphSizeScale(modelDisplayScale("narrowbody"), 5),
  );
  assert.equal(
    getAircraftScenegraphSizeScale(modelDisplayScale("narrowbody"), 6),
    BASE_3D_MODEL_SIZE * modelDisplayScale("narrowbody"),
  );
});

test("effective 3D scale keeps A380 larger than narrowbody", () => {
  assert.ok(
    getEffectiveModelScale("a380") > getEffectiveModelScale("narrowbody"),
  );
});

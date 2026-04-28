import assert from "node:assert/strict";
import test from "node:test";

import { getEffectiveModelScale } from "./aircraft-model-calibration";
import { aircraftSizeMultiplier } from "./aircraft-appearance";
import {
  BASE_3D_MODEL_SIZE,
  getAircraftModelZoomCompensation,
  getAircraftScenegraphSizeScale,
  getModelMaxPixels,
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

test("3D zoom compensation stays neutral as the camera zoom changes", () => {
  assert.equal(getAircraftModelZoomCompensation(5), 1);
  assert.equal(getAircraftModelZoomCompensation(8), 1);
});

test("3D zoom compensation safely ignores non-finite zoom values", () => {
  assert.equal(getAircraftModelZoomCompensation(Number.NaN), 1);
});

test("3D full-aircraft pixel targets are large enough for map readability", () => {
  assert.equal(getModelMaxPixels("a380"), 48);
  assert.ok(getModelMaxPixels("narrowbody") > 32);
  assert.ok(getModelMaxPixels("narrowbody") < 33);
});

test("scenegraph size scale keeps A380 larger than narrowbody without zoom compensation", () => {
  assert.ok(
    getAircraftScenegraphSizeScale(modelDisplayScale("a380"), 5) >
      getAircraftScenegraphSizeScale(modelDisplayScale("narrowbody"), 5),
  );
  assert.equal(
    getAircraftScenegraphSizeScale(modelDisplayScale("narrowbody"), 6),
    BASE_3D_MODEL_SIZE * modelDisplayScale("narrowbody"),
  );
  assert.equal(
    getAircraftScenegraphSizeScale(modelDisplayScale("narrowbody"), 5),
    getAircraftScenegraphSizeScale(modelDisplayScale("narrowbody"), 8),
  );
});

test("effective 3D scale keeps A380 larger than narrowbody", () => {
  assert.ok(
    getEffectiveModelScale("a380") > getEffectiveModelScale("narrowbody"),
  );
});

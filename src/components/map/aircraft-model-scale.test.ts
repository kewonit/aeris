import assert from "node:assert/strict";
import test from "node:test";

import { getEffectiveModelScale } from "./aircraft-model-calibration.ts";
import { aircraftSizeMultiplier } from "./aircraft-appearance.ts";
import { modelDisplayScale } from "./aircraft-model-mapping.ts";

test("A380 scale stays larger than B737 scale", () => {
  assert.ok(modelDisplayScale("a380") > modelDisplayScale("b737"));
});

test("heavy fallback stays larger than narrowbody fallback", () => {
  const heavy = aircraftSizeMultiplier(null, 6);
  const narrowbody = aircraftSizeMultiplier(null, 4);

  assert.ok(heavy > narrowbody);
});

test("effective 3D scale keeps A380 larger than narrowbody", () => {
  assert.ok(getEffectiveModelScale("a380") > getEffectiveModelScale("narrowbody"));
});

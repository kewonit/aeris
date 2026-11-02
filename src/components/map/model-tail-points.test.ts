import assert from "node:assert/strict";
import test from "node:test";

import { ALL_MODEL_KEYS } from "./aircraft-model-mapping";
import { MODEL_TAIL_POINTS } from "./model-tail-points";

test("every model's trail meets a tail cone behind it, near its centre height", () => {
  for (const key of ALL_MODEL_KEYS) {
    const tail = MODEL_TAIL_POINTS[key];
    assert.ok(tail, key);
    // Behind the centre and within the model, whose larger span is one.
    assert.ok(tail.back > 0.2 && tail.back < 0.5, `${key} back ${tail.back}`);
    // Within the fuselage's height, well below any fin's top.
    assert.ok(Math.abs(tail.up) < 0.1, `${key} up ${tail.up}`);
  }
});

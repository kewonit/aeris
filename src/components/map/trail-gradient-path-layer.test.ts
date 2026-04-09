import assert from "node:assert/strict";
import test from "node:test";

import { flattenPathColors } from "./trail-gradient-path-layer";

test("flattenPathColors preserves explicit per-vertex colors", () => {
  const result = flattenPathColors(3, [
    [10, 20, 30, 40],
    [50, 60, 70, 80],
    [90, 100, 110, 120],
  ]);

  assert.deepStrictEqual(
    Array.from(result),
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
  );
});

test("flattenPathColors expands one uniform color across rendered segments", () => {
  const result = flattenPathColors(4, [1, 2, 3, 4]);

  assert.deepStrictEqual(
    Array.from(result),
    [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4],
  );
});

test("flattenPathColors rejects per-vertex color counts that do not match the path", () => {
  assert.throws(() =>
    flattenPathColors(3, [
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ]),
  );
});

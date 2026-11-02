import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration } from "./format-duration";

test("durations read the same everywhere", () => {
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(14.4), "14 min");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(65), "1h 5m");
  assert.equal(formatDuration(-3), "0 min");
});

test("estimates past an hour round to five minutes", () => {
  assert.equal(formatDuration(72, { estimate: true }), "1h 10m");
  assert.equal(formatDuration(118, { estimate: true }), "2h");
  assert.equal(formatDuration(43, { estimate: true }), "43 min");
});

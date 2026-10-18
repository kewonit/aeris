import assert from "node:assert/strict";
import test from "node:test";

import { getNextNegativeBackoffMs } from "./provider-health";

test("negative backoff steps through 30s, 60s, 120s, 300s", () => {
  assert.equal(getNextNegativeBackoffMs(0), 30_000);
  assert.equal(getNextNegativeBackoffMs(30_000), 60_000);
  assert.equal(getNextNegativeBackoffMs(60_000), 120_000);
  assert.equal(getNextNegativeBackoffMs(120_000), 300_000);
  assert.equal(getNextNegativeBackoffMs(300_000), 300_000);
});

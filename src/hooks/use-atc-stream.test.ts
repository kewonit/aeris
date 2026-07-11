import assert from "node:assert/strict";
import test from "node:test";

import { getAtcReconnectDelayMs } from "./use-atc-stream";

test("ATC reconnects use bounded exponential backoff", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(getAtcReconnectDelayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000],
  );
  assert.equal(getAtcReconnectDelayMs(10), 30_000);
});

test("ATC reconnect delay normalizes invalid negative attempts", () => {
  assert.equal(getAtcReconnectDelayMs(-3), 1_000);
  assert.equal(getAtcReconnectDelayMs(Number.NaN), 1_000);
});

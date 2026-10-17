import assert from "node:assert/strict";
import test from "node:test";

import { relayReconnectDelayMs } from "./use-flight-stream";

test("relay reconnect storms use bounded jittered exponential backoff", () => {
  assert.equal(relayReconnectDelayMs(0, 0), 750);
  assert.equal(relayReconnectDelayMs(0, 1), 1_250);
  assert.equal(relayReconnectDelayMs(20, 0), 22_500);
  assert.equal(relayReconnectDelayMs(20, 1), 37_500);
  assert.equal(relayReconnectDelayMs(-10, -1), 750);
});

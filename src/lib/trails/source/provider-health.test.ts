import assert from "node:assert/strict";
import test from "node:test";

import {
  getNextNegativeBackoffMs,
  noteProviderFailure,
  noteProviderSuccess,
} from "./provider-health";

test("negative backoff steps through 30s, 60s, 120s, 300s", () => {
  assert.equal(getNextNegativeBackoffMs(0), 30_000);
  assert.equal(getNextNegativeBackoffMs(30_000), 60_000);
  assert.equal(getNextNegativeBackoffMs(60_000), 120_000);
  assert.equal(getNextNegativeBackoffMs(120_000), 300_000);
  assert.equal(getNextNegativeBackoffMs(300_000), 300_000);
});

test("success resets error streak and cooldown", () => {
  const failed = noteProviderFailure(
    {
      id: "adsb-fi",
      errorStreak: 2,
      cooldownUntil: 1_000,
      lastSuccessAt: 0,
      lastLatencyMs: null,
    },
    { now: 5_000, retryAfterMs: 60_000 },
  );

  const recovered = noteProviderSuccess(failed, {
    now: 10_000,
    latencyMs: 120,
  });

  assert.equal(recovered.errorStreak, 0);
  assert.equal(recovered.cooldownUntil, 0);
  assert.equal(recovered.lastSuccessAt, 10_000);
  assert.equal(recovered.lastLatencyMs, 120);
});

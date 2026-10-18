import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderHealth,
  PROVIDER_HEALTH_KEY,
  PROVIDER_HEALTH_TTL_MS,
  type StorageLike,
} from "./provider-health";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const IDS = ["adsb", "adsbfi", "airplanes", "opensky"] as const;

test("providers that answer are asked quickest first, untried ones next, failing ones last", () => {
  let clock = 1_000_000;
  const health = createProviderHealth(null, () => clock);
  assert.deepEqual(health.order(IDS), [...IDS]);

  health.noteAnswer("adsb", 4_000);
  health.noteAnswer("adsbfi", 200);
  health.noteFailure("airplanes");
  clock += 1_000;
  assert.deepEqual(health.order(IDS), ["adsbfi", "adsb", "opensky", "airplanes"]);

  // A failure drops a provider behind the untried ones, until it answers.
  health.noteFailure("adsb");
  assert.deepEqual(health.order(IDS), ["adsbfi", "opensky", "adsb", "airplanes"]);
  health.noteAnswer("adsb", 300);
  assert.deepEqual(health.order(IDS), ["adsbfi", "adsb", "opensky", "airplanes"]);
});

test("the answer time is an average that follows the latest answers", () => {
  const health = createProviderHealth();
  health.noteAnswer("adsb", 1_000);
  health.noteAnswer("adsb", 2_000);
  assert.equal(health.get("adsb")?.latencyMs, 1_300);
  health.noteFailure("adsb");
  assert.equal(health.get("adsb")?.failures, 1);
  health.noteAnswer("adsb", 500);
  assert.equal(health.get("adsb")?.failures, 0);
});

test("the record survives a reload for a quarter of an hour", () => {
  let clock = 5_000_000;
  const storage = memoryStorage();
  const first = createProviderHealth(storage, () => clock);
  first.noteAnswer("adsbfi", 200);
  first.noteAnswer("adsb", 3_000);
  assert.ok(storage.data.has(PROVIDER_HEALTH_KEY));

  clock += 60_000;
  const reloaded = createProviderHealth(storage, () => clock);
  assert.deepEqual(reloaded.order(IDS), ["adsbfi", "adsb", "airplanes", "opensky"]);

  clock += PROVIDER_HEALTH_TTL_MS;
  const later = createProviderHealth(storage, () => clock);
  assert.deepEqual(later.order(IDS), [...IDS]);
});

test("unreadable or missing storage is simply no memory", () => {
  const broken: StorageLike = {
    getItem: () => "{not json",
    setItem: () => {
      throw new Error("quota");
    },
  };
  const health = createProviderHealth(broken);
  health.noteAnswer("adsb", 100);
  assert.equal(health.get("adsb")?.latencyMs, 100);
  assert.deepEqual(health.order(IDS), ["adsb", "adsbfi", "airplanes", "opensky"]);
  health.reset();
  assert.deepEqual(health.order(IDS), [...IDS]);
});

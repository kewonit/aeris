import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenSkyCooldownMs,
  preferNextProvider,
} from "./server-trace-service";

test("OpenSky cooldown prefers documented retry-after header values", () => {
  assert.equal(createOpenSkyCooldownMs({ retryAfterHeader: "75" }), 75_000);
  assert.equal(createOpenSkyCooldownMs({ retryAfterHeader: null }), 60_000);
});

test("preferred provider only changes after a successful fallback", () => {
  assert.equal(preferNextProvider("adsb-fi", "adsb-fi"), "adsb-fi");
  assert.equal(
    preferNextProvider("adsb-fi", "airplanes-live"),
    "airplanes-live",
  );
});

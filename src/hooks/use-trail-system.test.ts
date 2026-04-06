import assert from "node:assert/strict";
import test from "node:test";

import { getHistoryRefreshMs } from "./use-trail-system";

test("OpenSky refresh slows down as credits fall", () => {
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 300 }),
    15_000,
  );
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 120 }),
    30_000,
  );
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 25 }),
    60_000,
  );
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 0 }),
    0,
  );
});

test("non-OpenSky providers keep the normal refresh cadence", () => {
  assert.equal(
    getHistoryRefreshMs({ provider: "adsb-lol", creditsRemaining: null }),
    15_000,
  );
});

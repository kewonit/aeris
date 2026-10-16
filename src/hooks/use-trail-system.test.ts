import assert from "node:assert/strict";
import test from "node:test";

import {
  getHistoryLoadDisposition,
  getHistoryRefreshMs,
} from "./use-trail-system";

test("OpenSky refresh slows down as credits fall", () => {
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 300 }),
    60_000,
  );
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 120 }),
    120_000,
  );
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 25 }),
    300_000,
  );
  assert.equal(
    getHistoryRefreshMs({ provider: "opensky", creditsRemaining: 0 }),
    0,
  );
});

test("non-OpenSky providers keep the normal refresh cadence", () => {
  assert.equal(
    getHistoryRefreshMs({ provider: "adsb-lol", creditsRemaining: null }),
    60_000,
  );
});

test("an in-flight history request is reused instead of starting a duplicate load", () => {
  assert.equal(
    getHistoryLoadDisposition({
      online: true,
      hidden: false,
      requestInFlight: true,
    }),
    "in-flight",
  );

  assert.equal(
    getHistoryLoadDisposition({
      online: true,
      hidden: false,
      requestInFlight: false,
    }),
    "start",
  );
});

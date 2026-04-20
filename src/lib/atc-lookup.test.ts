import assert from "node:assert/strict";
import test from "node:test";

import { AIRPORTS } from "./airports";
import {
  __internals,
  findNearbyAtcFeeds,
  iataToIcao,
  icaoToIata,
} from "./atc-lookup";

test("curated airport code lookups stay on the curated map path", () => {
  __internals.resetFullMaps();

  assert.equal(__internals.hasBuiltFullMaps(), false);
  assert.equal(iataToIcao("JFK"), "KJFK");
  assert.equal(icaoToIata("KJFK"), "JFK");
  assert.equal(__internals.hasBuiltFullMaps(), false);
});

test("non-curated airport code lookups fall back to the full airport database", () => {
  __internals.resetFullMaps();

  assert.equal(iataToIcao("IAH"), "KIAH");
  assert.equal(icaoToIata("KIAH"), "IAH");
  assert.equal(__internals.hasBuiltFullMaps(), true);
});

test("nearby ATC lookup still includes fallback-only airports with feeds", () => {
  const airport = AIRPORTS.find((entry) => entry.iata === "IAH");

  assert.ok(airport, "expected IAH to exist in AIRPORTS");

  const results = findNearbyAtcFeeds(airport.lat, airport.lng, 1, 10);

  assert.ok(
    results.some((result) => result.icao === "KIAH" && result.iata === "IAH"),
  );
});

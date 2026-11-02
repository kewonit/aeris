import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "./opensky";
import {
  classifySearchQuery,
  matchLiveFlights,
  nearestFlights,
} from "./search-query";

function flight(
  icao24: string,
  callsign: string | null,
  extra: Partial<FlightState> = {},
): FlightState {
  return {
    icao24,
    callsign,
    latitude: 51.5,
    longitude: -0.1,
    onGround: false,
    registration: null,
    ...extra,
  } as FlightState;
}

test("one box tells flights, aircraft, airports and places apart", () => {
  const kind = (q: string) => classifySearchQuery(q);
  assert.equal(kind("BAW20R").flightLike, true);
  assert.equal(kind("ua 123").flightLike, true);
  assert.equal(kind("6E2341").flightLike, true);
  assert.equal(kind("a1b2c3").hex, true);
  assert.equal(kind("G-VIIJ").registrationLike, true);
  assert.equal(kind("N123AB").registrationLike, true);
  assert.equal(kind("BOM").airportCodeLike, true);
  assert.equal(kind("VABB").airportCodeLike, true);
  assert.equal(kind("Mumbai").placeLike, true);
  assert.equal(kind("BAW20R").placeLike, false);
  assert.equal(kind("G-VIIJ").placeLike, false);
});

test("exact callsigns, addresses and registrations come first", () => {
  const flights = [
    flight("400aaa", "BAW201"),
    flight("400610", "BAW20R"),
    flight("406bbb", "EZY20", { registration: "G-EZWX" }),
  ];
  assert.deepEqual(
    matchLiveFlights("BAW20R", flights).map((f) => f.icao24),
    ["400610"],
  );
  assert.deepEqual(
    matchLiveFlights("baw20", flights).map((f) => f.icao24),
    ["400aaa", "400610"],
  );
  assert.deepEqual(
    matchLiveFlights("G-EZWX", flights).map((f) => f.icao24),
    ["406bbb"],
  );
  assert.deepEqual(
    matchLiveFlights("400610", flights).map((f) => f.icao24),
    ["400610"],
  );
  assert.deepEqual(matchLiveFlights("b", flights), []);
});

test("the empty box offers the airborne aircraft nearest the map", () => {
  const flights = [
    flight("aaaaaa", "FAR1", { latitude: 55, longitude: 5 }),
    flight("bbbbbb", "NEAR1", { latitude: 51.5, longitude: -0.2 }),
    flight("cccccc", "GND1", { latitude: 51.5, longitude: -0.1, onGround: true }),
    flight("dddddd", null, { latitude: 51.5, longitude: -0.1 }),
  ];
  assert.deepEqual(
    nearestFlights(flights, [-0.1, 51.5]).map((f) => f.icao24),
    ["bbbbbb", "aaaaaa"],
  );
});

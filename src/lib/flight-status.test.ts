import assert from "node:assert/strict";
import test from "node:test";

import type { RouteAirport } from "./route-lookup";
import {
  describeFlightStatus,
  estimateMinutesRemaining,
  type FlightStatusInput,
} from "./flight-status";

const FT = 0.3048;
const KT = 0.514444;

const DEL: RouteAirport = {
  iata: "DEL",
  icao: "VIDP",
  name: "Indira Gandhi International Airport",
  municipality: "New Delhi",
  countryIso: "IN",
  latitude: 28.5562,
  longitude: 77.1,
};
const BOM: RouteAirport = {
  iata: "BOM",
  icao: "VABB",
  name: "Chhatrapati Shivaji Maharaj International Airport",
  municipality: "Mumbai",
  countryIso: "IN",
  latitude: 19.0887,
  longitude: 72.8679,
};

type Flight = FlightStatusInput["flight"];

function flight(overrides: Partial<Flight>): Flight {
  return {
    onGround: false,
    baroAltitude: 36_000 * FT,
    geoAltitude: null,
    verticalRate: 0,
    geomRate: null,
    velocity: 480 * KT,
    latitude: 24,
    longitude: 75,
    squawk: null,
    emergencyStatus: null,
    ...overrides,
  };
}

/** A point `fraction` of the way from DEL to BOM. */
function along(fraction: number) {
  return {
    latitude: DEL.latitude + (BOM.latitude - DEL.latitude) * fraction,
    longitude: DEL.longitude + (BOM.longitude - DEL.longitude) * fraction,
  };
}

const route = { origin: DEL, destination: BOM };

function status(f: Partial<Flight>, extra: Partial<FlightStatusInput> = {}) {
  return describeFlightStatus({
    flight: flight(f),
    route,
    units: "aviation",
    ...extra,
  });
}

test("cruising says where to and roughly how long", () => {
  const s = status(along(0.5));
  assert.equal(s.phase, "cruising");
  assert.equal(s.headline, "Cruising to BOM");
  assert.match(s.timing ?? "", /^about (\d+ min|\dh( \d+m)?) to go$/);
  assert.ok(s.progress !== null && Math.abs(s.progress - 0.5) < 0.05);
  assert.equal(s.sentence, `${s.headline} · ${s.timing}`);
});

test("a descent into the destination counts down", () => {
  const s = status({ ...along(0.9), baroAltitude: 18_000 * FT, verticalRate: -8 });
  assert.equal(s.phase, "descending");
  assert.equal(s.headline, "Descending into BOM");
  assert.match(s.timing ?? "", /^about \d+ min out$/);
});

test("close in and low is an approach, and the last minutes are landing now", () => {
  const close = {
    latitude: BOM.latitude + 0.05,
    longitude: BOM.longitude + 0.05,
  };
  const s = status({
    ...close,
    baroAltitude: 1_500 * FT,
    verticalRate: -3,
    velocity: 150 * KT,
  });
  assert.equal(s.phase, "approach");
  assert.equal(s.headline, "On approach to BOM");
  assert.equal(s.timing, "landing now");
});

test("climbing near the origin is climbing out of it", () => {
  const s = status({
    ...along(0.05),
    baroAltitude: 12_000 * FT,
    verticalRate: 10,
    velocity: 290 * KT,
  });
  assert.equal(s.phase, "climbing");
  assert.equal(s.headline, "Climbing out of DEL");
});

test("a step climb at cruise is still cruising", () => {
  const s = status({ ...along(0.5), baroAltitude: 37_000 * FT, verticalRate: 5 });
  assert.equal(s.phase, "cruising");
});

test("on the ground the line names the airport it is at", () => {
  const atBom = { latitude: BOM.latitude, longitude: BOM.longitude };
  assert.equal(
    status({ ...atBom, onGround: true, velocity: 15 * KT }).headline,
    "Taxiing at BOM",
  );
  assert.equal(
    status({ ...atBom, onGround: true, velocity: 0 }).headline,
    "Parked at BOM",
  );
  assert.equal(
    status({ ...atBom, onGround: true, velocity: 120 * KT }).headline,
    "Landed at BOM",
  );
  assert.equal(status({ ...atBom, onGround: true, velocity: 0 }).timing, null);
});

test("without a route the line falls back to height", () => {
  const s = describeFlightStatus({ flight: flight({}), route: null, units: "aviation" });
  assert.equal(s.headline, "Cruising at 36,000 ft");
  assert.equal(s.timing, null);
  assert.equal(s.progress, null);

  const low = describeFlightStatus({
    flight: flight({ baroAltitude: 3_040 * FT }),
    route: null,
    units: "aviation",
  });
  assert.equal(low.headline, "Flying at 3,000 ft");
});

test("a mismatched route is not trusted and says so", () => {
  const s = status(along(0.5), { route: { ...route, mismatch: true } });
  assert.equal(s.headline, "Cruising at 36,000 ft");
  assert.equal(s.timing, null);
  assert.deepEqual(s.cause, {
    text: "The reported route doesn’t match this aircraft",
    tone: "neutral",
  });
});

test("an emergency outranks the weather", () => {
  const s = status({ ...along(0.5), squawk: "7700" }, { weather: "BOM: heavy rain" });
  assert.deepEqual(s.cause, { text: "Squawking 7700 · emergency", tone: "danger" });

  const weather = status(along(0.9), { weather: "BOM: heavy rain" });
  assert.deepEqual(weather.cause, { text: "BOM: heavy rain", tone: "warning" });
});

test("too slow to estimate gives no time", () => {
  const s = status({ ...along(0.5), velocity: 30 * KT });
  assert.equal(s.timing, null);
  assert.equal(s.minutesRemaining, null);
});

test("the last hundred miles are timed slowing down", () => {
  const knots = (kt: number) => kt * KT;
  // 50 nm at 415 kt is about 7 minutes flat out, but the aircraft slows.
  const near = estimateMinutesRemaining(50, knots(415));
  assert.ok(near > 10 && near < 11.5, `got ${near}`);
  // Far out, the cruise part runs at cruise speed.
  const far = estimateMinutesRemaining(500, knots(480));
  assert.ok(far > 65 && far < 72, `got ${far}`);
  // Already slow: never faster than the current speed.
  assert.equal(
    Math.round(estimateMinutesRemaining(10, knots(140))),
    Math.round((10 / 140) * 60),
  );
});

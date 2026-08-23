import assert from "node:assert/strict";
import test from "node:test";

import type { RouteAirport } from "./route-lookup";
import { validateReportedRoute } from "./route-validation";

const sfo: RouteAirport = {
  iata: "SFO",
  icao: "KSFO",
  name: "San Francisco International Airport",
  municipality: "San Francisco",
  countryIso: "US",
  latitude: 37.618999,
  longitude: -122.375,
};

const jfk: RouteAirport = {
  iata: "JFK",
  icao: "KJFK",
  name: "John F. Kennedy International Airport",
  municipality: "New York",
  countryIso: "US",
  latitude: 40.639801,
  longitude: -73.7789,
};

function context(
  latitude: number,
  longitude: number,
  altitudeMeters = 10_668,
  onGround = false,
) {
  return {
    icao24: "abc123",
    callsign: "DAL1598",
    latitude,
    longitude,
    altitudeMeters,
    onGround,
    observationTime: 1_700_000_000_000,
  };
}

test("accepts an aircraft inside the bounded route corridor", () => {
  const result = validateReportedRoute(
    sfo,
    jfk,
    context(39.5, -98.5),
  );
  assert.equal(result.valid, true);
  assert.ok(result.corridorToleranceNm >= 50);
  assert.ok(result.corridorToleranceNm <= 250);
});

test("rejects a DAL1598-style conflicting SFO route", () => {
  const result = validateReportedRoute(
    sfo,
    jfk,
    context(33.6407, -84.4277),
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "corridor");
});

test("requires a ground aircraft to be within fifteen nautical miles", () => {
  assert.equal(
    validateReportedRoute(sfo, jfk, context(37.62, -122.38, 0, true)).valid,
    true,
  );
  const result = validateReportedRoute(
    sfo,
    jfk,
    context(37.95, -121.95, 0, true),
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "ground-endpoint");
});

test("requires a low aircraft to be near a route endpoint", () => {
  const result = validateReportedRoute(
    sfo,
    jfk,
    context(39.5, -98.5, 2_000),
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "low-endpoint");
});

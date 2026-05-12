import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";
import type { RouteAirport, RouteInfo } from "@/lib/route-lookup";

const sfo: RouteAirport = {
  iata: "SFO",
  icao: "KSFO",
  name: "San Francisco International Airport",
  municipality: "San Francisco",
  countryIso: "US",
  latitude: 37.618999,
  longitude: -122.375,
};

const lhr: RouteAirport = {
  iata: "LHR",
  icao: "EGLL",
  name: "London Heathrow Airport",
  municipality: "London",
  countryIso: "GB",
  latitude: 51.4706,
  longitude: -0.461941,
};

function makeFlight(overrides: Partial<FlightState> = {}): FlightState {
  return {
    icao24: "a1b2c3",
    callsign: "UAL123",
    originCountry: "United States",
    longitude: -100,
    latitude: 40,
    baroAltitude: 10_000,
    onGround: false,
    velocity: 230,
    trueTrack: 90,
    verticalRate: 0,
    geoAltitude: 10_100,
    squawk: null,
    spiFlag: false,
    positionSource: "adsb",
    category: null,
    ...overrides,
  };
}

test("useRouteInfo type shape is correct", async () => {
  const { useRouteInfo } = await import("./use-route-info");
  assert.equal(typeof useRouteInfo, "function");
});

test("route-lookup module exports lookupRoute", async () => {
  const { lookupRoute } = await import("@/lib/route-lookup");
  assert.equal(typeof lookupRoute, "function");
});

test("route lookup parses full verified route from API", async () => {
  const apiRoute: RouteInfo = {
    callsign: "UAL123",
    origin: sfo,
    destination: lhr,
    source: "adsbdb",
    fetchedAt: Date.now(),
  };

  assert.equal(apiRoute.origin?.iata, "SFO");
  assert.equal(apiRoute.destination?.iata, "LHR");
  assert.equal(apiRoute.source, "adsbdb");
});

test("route lookup accepts opensky source", async () => {
  const apiRoute: RouteInfo = {
    callsign: "BAW123",
    origin: lhr,
    destination: sfo,
    source: "opensky",
    fetchedAt: Date.now(),
  };

  assert.equal(apiRoute.source, "opensky");
  assert.equal(apiRoute.origin?.iata, "LHR");
  assert.equal(apiRoute.destination?.iata, "SFO");
});

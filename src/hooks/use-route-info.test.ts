import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState, FlightTrack } from "@/lib/opensky";
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
    positionSource: 0,
    category: null,
    ...overrides,
  };
}

function makeDepartureTrack(): FlightTrack {
  return {
    icao24: "a1b2c3",
    callsign: "UAL123",
    startTime: 1,
    endTime: 2,
    path: [
      {
        time: 1,
        latitude: sfo.latitude,
        longitude: sfo.longitude,
        baroAltitude: 20,
        trueTrack: 280,
        onGround: true,
      },
      {
        time: 2,
        latitude: 37.7,
        longitude: -122.5,
        baroAltitude: 600,
        trueTrack: 280,
        onGround: false,
      },
    ],
  };
}

test("buildRouteInfo does not invent a destination when route APIs miss", async () => {
  const { buildRouteInfo } = await import("./use-route-info");

  const result = buildRouteInfo(
    makeFlight({
      latitude: 40.64,
      longitude: -73.78,
      trueTrack: 270,
      verticalRate: -6,
      baroAltitude: 3_000,
    }),
    null,
    false,
    null,
  );

  assert.equal(result.origin, null);
  assert.equal(result.destination, null);
  assert.equal(result.destinationConfidence, null);
  assert.equal(result.source, null);
  assert.equal(result.routeDisplay, null);
});

test("buildRouteInfo keeps observed departure separate from missing API destination", async () => {
  const { buildRouteInfo } = await import("./use-route-info");

  const result = buildRouteInfo(
    makeFlight({
      latitude: 38.5,
      longitude: -124,
      trueTrack: 80,
      verticalRate: 8,
      baroAltitude: 1_800,
    }),
    null,
    false,
    makeDepartureTrack(),
  );

  assert.equal(result.origin?.iata, "SFO");
  assert.equal(result.destination, null);
  assert.equal(result.destinationConfidence, null);
  assert.equal(result.source, "observed");
  assert.equal(result.routeDisplay, "From SFO");
});

test("buildRouteInfo labels complete free API route data as route database data", async () => {
  const { buildRouteInfo } = await import("./use-route-info");
  const apiRoute: RouteInfo = {
    callsign: "UAL123",
    origin: sfo,
    destination: lhr,
    source: "adsbdb",
    fetchedAt: Date.now(),
  };

  const result = buildRouteInfo(makeFlight(), apiRoute, false, null);

  assert.equal(result.origin?.iata, "SFO");
  assert.equal(result.destination?.iata, "LHR");
  assert.equal(result.destinationConfidence, "known");
  assert.equal(result.source, "route-database");
  assert.equal(result.routeDisplay, "SFO → LHR");
});

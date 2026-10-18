import assert from "node:assert/strict";
import test from "node:test";

import type { ReportedRoute, RouteAirport } from "./route-lookup";
import {
  distanceToRouteCorridorNm,
  isRouteConsistentWithPosition,
  selectReportedRoute,
} from "./route-validation";

function airport(code: string, latitude: number, longitude: number): RouteAirport {
  return {
    iata: code,
    icao: `X${code}`,
    name: code,
    municipality: code,
    countryIso: "",
    latitude,
    longitude,
  };
}

const SFO = airport("SFO", 37.619, -122.375);
const JFK = airport("JFK", 40.6398, -73.7789);
const FRA = airport("FRA", 50.0333, 8.5706);
const ICN = airport("ICN", 37.4602, 126.4407);
const HNL = airport("HNL", 21.3187, -157.9225);
const NRT = airport("NRT", 35.7647, 140.3864);

function route(
  origin: RouteAirport,
  destination: RouteAirport,
  source: ReportedRoute["source"] = "adsbdb",
): ReportedRoute {
  return { callsign: "TEST1", origin, destination, source, fetchedAt: 0 };
}

function cruising(latitude: number, longitude: number) {
  return { latitude, longitude, altitudeMeters: 11_000, onGround: false };
}

test("accepts a cruising aircraft along the route", () => {
  assert.equal(
    isRouteConsistentWithPosition(route(SFO, JFK), cruising(40.5, -100)),
    true,
  );
});

test("rejects a route the aircraft is nowhere near", () => {
  assert.equal(
    isRouteConsistentWithPosition(route(SFO, JFK), cruising(45, -30)),
    false,
  );
});

test("accepts a long-haul routing that bends around closed airspace", () => {
  // FRA to ICN south of Russia, over Almaty, roughly 900 nm off the great circle.
  const position = cruising(43.2, 76.9);
  assert.ok(distanceToRouteCorridorNm(position, FRA, ICN) > 250);
  assert.equal(isRouteConsistentWithPosition(route(FRA, ICN), position), true);
});

test("measures the corridor across the antimeridian", () => {
  for (const longitude of [179.5, -179.5]) {
    const position = cruising(30.5, longitude);
    assert.ok(distanceToRouteCorridorNm(position, HNL, NRT) < 50);
    assert.equal(isRouteConsistentWithPosition(route(HNL, NRT), position), true);
  }
});

test("rejects a route when the aircraft is parked at another airport", () => {
  const atLax = { latitude: 33.9416, longitude: -118.4085, altitudeMeters: 30, onGround: true };
  assert.equal(isRouteConsistentWithPosition(route(SFO, JFK), atLax), false);
  const atSfo = { ...atLax, latitude: 37.62, longitude: -122.38 };
  assert.equal(isRouteConsistentWithPosition(route(SFO, JFK), atSfo), true);
});

test("rejects a low aircraft far from both ends", () => {
  const low = { latitude: 40.5, longitude: -100, altitudeMeters: 900, onGround: false };
  assert.equal(isRouteConsistentWithPosition(route(SFO, JFK), low), false);
});

test("selects the first provider route that fits the position", () => {
  const stale = route(FRA, ICN, "adsbdb");
  const current = route(SFO, JFK, "hexdb");
  assert.equal(selectReportedRoute([stale, current], cruising(40.5, -100)), current);
  assert.equal(selectReportedRoute([stale], cruising(40.5, -100)), null);
});

test("keeps the first route when there is no position to check", () => {
  const first = route(FRA, ICN);
  assert.equal(selectReportedRoute([first, route(SFO, JFK)], null), first);
  assert.equal(selectReportedRoute([], null), null);
});

test("rejects a route the aircraft is flying in reverse", () => {
  // Climbing east out of SFO with a reported JFK to SFO route.
  const departingSfo = {
    latitude: 37.9,
    longitude: -121.6,
    altitudeMeters: 6_000,
    onGround: false,
    verticalRate: 8,
  };
  assert.equal(isRouteConsistentWithPosition(route(JFK, SFO), departingSfo), false);
  assert.equal(isRouteConsistentWithPosition(route(SFO, JFK), departingSfo), true);
});

test("keeps the route for a go-around close to the destination", () => {
  const goAround = {
    latitude: 37.7,
    longitude: -122.3,
    altitudeMeters: 600,
    onGround: false,
    verticalRate: 10,
  };
  assert.equal(isRouteConsistentWithPosition(route(JFK, SFO), goAround), true);
});

test("keeps the route through a step climb at cruise", () => {
  // Past halfway on SFO to JFK, climbing from FL350 to FL370.
  const stepClimb = {
    latitude: 40.8,
    longitude: -85,
    altitudeMeters: 10_900,
    onGround: false,
    verticalRate: 6,
  };
  assert.equal(isRouteConsistentWithPosition(route(SFO, JFK), stepClimb), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { ReportedRoute, RouteAirport } from "./route-lookup";
import {
  distanceToRouteCorridorNm,
  isRouteConsistentWithPosition,
  selectReportedRoute,
  type RoutePosition,
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

const LAX = airport("LAX", 33.9416, -118.4085);
const TEB = airport("TEB", 40.8501, -74.0608);
const MDT = airport("MDT", 40.1935, -76.7634);
const LGA = airport("LGA", 40.7769, -73.874);
const IAH = airport("IAH", 29.9844, -95.3414);
const SYD = airport("SYD", -33.9461, 151.1772);
const SIN = airport("SIN", 1.3502, 103.9944);
const LHR = airport("LHR", 51.4706, -0.4619);
const ORD = airport("ORD", 41.9786, -87.9048);
const BMI = airport("BMI", 40.4771, -88.9159);
const SAN = airport("SAN", 32.7336, -117.1897);
const OGG = airport("OGG", 20.8986, -156.4305);
const BOS = airport("BOS", 42.3656, -71.0096);
const RIC = airport("RIC", 37.5052, -77.3197);
const IND = airport("IND", 39.7173, -86.2944);

function flying(
  latitude: number,
  longitude: number,
  track: number,
  extra: Partial<RoutePosition> = {},
): RoutePosition {
  return { ...cruising(latitude, longitude), track, speed: 230, verticalRate: 0, ...extra };
}

test("rejects a route the aircraft has flown hundreds of miles past", () => {
  // Over northern California, southbound: nowhere near flying JFK to LAX.
  assert.equal(
    isRouteConsistentWithPosition(route(JFK, LAX), flying(41.25, -122.81, 176)),
    false,
  );
  // Joining the approach from beyond the airport is fine.
  assert.equal(
    isRouteConsistentWithPosition(route(JFK, LAX), {
      ...flying(33.6, -119.2, 70),
      altitudeMeters: 3_000,
    }),
    true,
  );
});

test("rejects a route the aircraft is flying back the other way", () => {
  assert.equal(
    isRouteConsistentWithPosition(route(SFO, JFK), flying(40.5, -100, 270)),
    false,
  );
  assert.equal(
    isRouteConsistentWithPosition(route(SFO, JFK), flying(40.5, -100, 80)),
    true,
  );
});

test("a route already shown survives the outbound leg of a hold far out", () => {
  const outbound = flying(40.5, -100, 270);
  const shown = route(SFO, JFK);
  assert.equal(selectReportedRoute([shown], outbound), null);
  assert.equal(selectReportedRoute([shown], outbound, shown), shown);
});

test("rejects a destination the aircraft is too high to land at", () => {
  // Level at 36,000 ft, 19 nm beyond MDT and flying on west.
  const overflying = flying(40.26, -77.16, 262, { altitudeMeters: 10_973 });
  assert.equal(isRouteConsistentWithPosition(route(TEB, MDT), overflying), false);
  // Holding nearby at 10,000 ft is an arrival.
  const holding = { ...overflying, altitudeMeters: 3_048 };
  assert.equal(isRouteConsistentWithPosition(route(TEB, MDT), holding), true);
});

test("near the destination, only the approach itself may point away from it", () => {
  const ITH = airport("ITH", 42.491, -76.4584);
  // 63 nm from Ithaca and flying on north-east, away from it.
  const leaving = flying(43.13, -75.31, 34, { altitudeMeters: 6_000 });
  assert.equal(isRouteConsistentWithPosition(route(TEB, ITH), leaving), false);
  assert.equal(
    isRouteConsistentWithPosition(route(TEB, ITH), { ...leaving, track: 225 }),
    true,
  );
  // 30 nm out on a downwind leg, being vectored in.
  const downwind = flying(42.75, -75.9, 34, { altitudeMeters: 3_000 });
  assert.equal(isRouteConsistentWithPosition(route(TEB, ITH), downwind), true);
});

test("rejects a route when the aircraft comes down to land at its origin", () => {
  const descendingIntoLga = flying(40.95, -73.1, 250, {
    altitudeMeters: 1_760,
    verticalRate: -6,
  });
  assert.equal(isRouteConsistentWithPosition(route(LGA, IAH), descendingIntoLga), false);
  assert.equal(isRouteConsistentWithPosition(route(IAH, LGA), descendingIntoLga), true);
});

test("picks the leg of a flight with a stop that the aircraft is flying", () => {
  const legs = [route(SYD, SIN), route(SIN, LHR)];
  // Over the Bay of Bengal, north-west bound.
  assert.equal(selectReportedRoute(legs, flying(15, 88, 300)), legs[1]);
  // Over Java, heading for Singapore.
  assert.equal(selectReportedRoute(legs, flying(-6, 108, 320)), legs[0]);
  // Climbing out of Singapore, still within reach of a go-around.
  const climbingOut = flying(1.5, 103.85, 315, {
    altitudeMeters: 1_500,
    verticalRate: 10,
  });
  assert.equal(selectReportedRoute(legs, climbingOut), legs[1]);
});

test("between the same two airports, picks the leg the aircraft points along", () => {
  const legs = [route(ORD, BMI), route(BMI, ORD)];
  const between = { altitudeMeters: 4_000, speed: 150 };
  assert.equal(selectReportedRoute(legs, flying(41.2, -88.4, 210, between)), legs[0]);
  assert.equal(selectReportedRoute(legs, flying(41.2, -88.4, 30, between)), legs[1]);
});

test("a route the aircraft is on beats a provider's route it is far off", () => {
  // Off San Francisco, bound for Hawaii: not a flight from San Diego.
  const stale = route(SAN, OGG, "adsbdb");
  const current = route(JFK, HNL, "vrs");
  assert.equal(
    selectReportedRoute([stale, current], flying(37.34, -123.55, 253)),
    current,
  );
});

test("a climb-out picks the route from the airport it is leaving", () => {
  const passing = route(BOS, RIC, "adsbdb");
  const leaving = route(JFK, IND, "vrs");
  const climbingOutOfJfk = flying(40.53, -73.67, 220, {
    altitudeMeters: 2_500,
    verticalRate: 18,
  });
  assert.equal(selectReportedRoute([passing, leaving], climbingOutOfJfk), leaving);
});

test("routes that fit about as well keep provider order", () => {
  const first = route(SFO, JFK, "vrs");
  const second = route(SFO, BOS, "adsbdb");
  const over = flying(40.8, -95, 80);
  assert.equal(selectReportedRoute([first, second], over), first);
  assert.equal(selectReportedRoute([second, first], over), second);
});

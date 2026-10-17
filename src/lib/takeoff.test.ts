import assert from "node:assert/strict";
import test from "node:test";

import type { FlightTrack, TrackWaypoint } from "./opensky";
import { findTakeoff } from "./takeoff";

const FEET = 0.3048;
// Chicago O'Hare, at 672 ft, and Midway, ten miles south-east.
const ORD = { latitude: 41.9786, longitude: -87.9048, elevation: 672 * FEET };
const MDW = { latitude: 41.786, longitude: -87.7524, elevation: 620 * FEET };

function point(
  minute: number,
  at: { latitude: number; longitude: number },
  feet: number | "ground",
  north = 0,
): TrackWaypoint {
  return {
    time: 1_000_000 + minute * 60,
    latitude: at.latitude + north,
    longitude: at.longitude,
    baroAltitude: feet === "ground" ? null : feet * FEET,
    trueTrack: 0,
    onGround: feet === "ground",
  };
}

function track(path: TrackWaypoint[]): FlightTrack {
  return { icao24: "abc123", startTime: 0, endTime: 0, callsign: null, path };
}

/** A climb out of an airport to cruise, a degree north every 10 minutes. */
function departure(from: typeof ORD, startMinute: number): TrackWaypoint[] {
  return [
    point(startMinute, from, "ground"),
    point(startMinute + 1, from, 1_200, 0.02),
    point(startMinute + 4, from, 9_000, 0.2),
    point(startMinute + 15, from, 30_000, 1.5),
    point(startMinute + 40, from, 35_000, 4),
  ];
}

test("finds the airport the aircraft took off from, and when", () => {
  const takeoff = findTakeoff(track(departure(ORD, 0)));
  assert.equal(takeoff?.airport?.icao, "KORD");
  // Its last point near the ground, just after lifting off.
  assert.equal(takeoff?.time, 1_000_060);
});

test("takes the last take-off of a day of flights, not the first", () => {
  // Out of Midway, back down at O'Hare, then out again.
  const day = [
    ...departure(MDW, 0),
    point(60, ORD, 20_000, 2),
    point(80, ORD, 3_000, 0.1),
    point(84, ORD, 1_000),
    point(86, ORD, "ground"),
    ...departure(ORD, 120),
  ];
  assert.equal(findTakeoff(track(day))?.airport?.icao, "KORD");
});

test("a go-around is not taken for a take-off", () => {
  const goAround = [
    ...departure(MDW, 0),
    point(60, ORD, 20_000, 2),
    point(78, ORD, 3_000, 0.2),
    point(80, ORD, 800),
    point(82, ORD, 3_500, 0.05),
    point(86, ORD, 2_500, 0.1),
  ];
  assert.equal(findTakeoff(track(goAround))?.airport?.icao, "KMDW");
});

test("a track that starts in the air shows no take-off", () => {
  assert.equal(findTakeoff(track(departure(ORD, 0).slice(2))), null);
});

test("a long gap low down could hide a landing, so it shows no take-off", () => {
  const unwatched = [
    ...departure(ORD, 0).slice(0, 3),
    point(90, ORD, 7_000, 2),
    point(100, ORD, 30_000, 3),
  ];
  assert.equal(findTakeoff(track(unwatched)), null);
  // Out of sight at cruise over an ocean is fine.
  const oceanic = [...departure(ORD, 0), point(280, ORD, 35_000, 20)];
  assert.equal(findTakeoff(track(oceanic))?.airport?.icao, "KORD");
});

test("an aircraft back on the ground shows no take-off", () => {
  const landed = [
    ...departure(MDW, 0),
    point(60, ORD, 20_000, 2),
    point(80, ORD, 1_000),
    point(84, ORD, "ground"),
  ];
  assert.equal(findTakeoff(track(landed)), null);
});

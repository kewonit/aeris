import assert from "node:assert/strict";
import test from "node:test";

import type { Airport } from "@/lib/airports";
import type { FlightState } from "@/lib/opensky";
import { classifyFlight } from "./use-airport-board";

const FT = 0.3048;

const airport = (elevationFt: number): Airport => ({
  iata: "TST",
  name: "Test Field",
  city: "Test",
  country: "XX",
  lat: 35,
  lng: 33,
  icao: "XTST",
  elevation_ft: elevationFt,
});

/** An aircraft `nm` west of the field, flying east towards it unless `trueTrack` says otherwise. */
function inbound(
  nm: number,
  altitudeFt: number,
  verticalRate: number | null,
  trueTrack: number | null = 90,
): FlightState {
  return {
    icao24: "abc123",
    callsign: "TST1",
    latitude: 35,
    longitude: 33 - nm / (60 * Math.cos((35 * Math.PI) / 180)),
    baroAltitude: altitudeFt * FT,
    geoAltitude: null,
    onGround: false,
    velocity: 120,
    trueTrack,
    verticalRate,
  } as FlightState;
}

test("a level aircraft too high to land in the distance left is passing over", () => {
  const result = classifyFlight(inbound(6, 30_000, 0), airport(8));
  assert.equal(result.direction, "overflight");
});

test("a level aircraft low enough to land in the distance left is arriving", () => {
  const result = classifyFlight(inbound(6, 3_000, 0), airport(8));
  assert.equal(result.direction, "arrival");
});

test("height is measured from the field, so a high field keeps its arrivals", () => {
  const result = classifyFlight(inbound(6, 7_000, 0), airport(5_434));
  assert.equal(result.direction, "arrival");
});

test("without a track, only a descent that can reach the field is an arrival", () => {
  const high = classifyFlight(inbound(6, 30_000, -8, null), airport(8));
  const low = classifyFlight(inbound(6, 3_000, -8, null), airport(8));
  assert.equal(high.direction, "overflight");
  assert.equal(low.direction, "arrival");
});

test("a level aircraft high over the field and flying away is passing over", () => {
  const result = classifyFlight(inbound(6, 35_000, 0, 270), airport(8));
  assert.equal(result.direction, "overflight");
});

test("a high cruiser climbing a little away from the field is not a departure", () => {
  const result = classifyFlight(inbound(10, 35_000, 3, 270), airport(8));
  assert.equal(result.direction, "overflight");
});

test("a departure climbing steeply away from the field is still a departure", () => {
  // A business jet 10 nm out at 12,000 ft, climbing 20 m/s.
  const result = classifyFlight(inbound(10, 12_000, 20, 270), airport(8));
  assert.equal(result.direction, "departure");
  // An airliner 8 nm out at 6,000 ft.
  assert.equal(classifyFlight(inbound(8, 6_000, 10, 270), airport(8)).direction, "departure");
});

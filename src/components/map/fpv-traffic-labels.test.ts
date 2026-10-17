import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  fpvTrafficLabelText,
  pickFpvTrafficLabels,
} from "./fpv-traffic-labels";

test("labels read like a traffic display: callsign, then hundreds of feet above or below", () => {
  const flight = { callsign: "UAL302  ", icao24: "a1b2c3" };
  assert.equal(fpvTrafficLabelText(flight, 1_200 * 0.3048), "UAL302 +12");
  assert.equal(fpvTrafficLabelText(flight, -480 * 0.3048), "UAL302 -05");
  const unnamed = { callsign: null, icao24: "a1b2c3" };
  assert.equal(fpvTrafficLabelText(unnamed, 0), "A1B2C3 +00");
});

test("only airborne traffic in range is labelled, nearest first", () => {
  type Placed = FlightState & { distance: number };
  const at = (icao24: string, distance: number) =>
    ({
      icao24,
      callsign: icao24,
      longitude: 0,
      latitude: 0,
      baroAltitude: 3_000,
      distance,
    }) as Placed;
  const flights = [
    at("far", 30_000),
    at("near", 2_000),
    at("mid", 9_000),
    { ...at("taxiing", 1_000), onGround: true },
    at("behind", 3_000),
    at("alongside", 100),
  ];
  const labels = pickFpvTrafficLabels(
    flights,
    3_000,
    () => 3_000,
    (flight) => (flight as Placed).distance,
    () => 20,
    (flight) => flight.icao24 !== "behind",
  );
  assert.deepEqual(labels.map((label) => label.text), ["near +00", "mid +00"]);
  assert.equal(labels[0].lift, 10);
});

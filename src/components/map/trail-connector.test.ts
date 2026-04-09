import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import { buildTrailConnector } from "./trail-connector";
import { buildConnectorGradientColors } from "./trail-render-segments";

test("buildTrailConnector returns only a terminal connector path", () => {
  const connector = buildTrailConnector(
    [
      [8.0, 50.0, 1030],
      [8.1, 50.0, 1040],
    ],
    {
      icao24: "abc123",
      longitude: 8.15,
      latitude: 50.0,
      baroAltitude: 1050,
      trueTrack: 90,
    } as FlightState,
  );

  assert.ok(connector);
  assert.deepStrictEqual(connector?.[0], [8.1, 50.0, 1040]);
  const head = connector?.[connector!.length - 1];
  assert.ok(head);
  assert.ok(head![0] < 8.1498);
  assert.ok(head![0] > 8.1495);
  assert.equal(head![1], 50.0);
  assert.equal(head![2], 1050);
  assert.equal(connector!.length > 3, true);
});

test("buildTrailConnector stays near the tail-to-plane direction when aircraft heading diverges", () => {
  const connector = buildTrailConnector(
    [
      [8.0, 50.0, 1030],
      [8.1, 50.0, 1040],
    ],
    {
      icao24: "abc123",
      longitude: 8.2,
      latitude: 50.0,
      baroAltitude: 1050,
      trueTrack: 0,
    } as FlightState,
  );

  assert.ok(connector);

  const maxLatitudeDrift = Math.max(
    ...connector!.map((point) => Math.abs(point[1] - 50.0)),
  );

  assert.ok(maxLatitudeDrift < 0.01);
});

test("buildTrailConnector respects an explicit short tail gap calibration", () => {
  const aircraftLongitude = 8.025;
  const connector = buildTrailConnector(
    [
      [8.0, 50.0, 1000],
      [8.01, 50.0, 1010],
      [8.02, 50.0, 1020],
    ],
    {
      icao24: "abc123",
      longitude: aircraftLongitude,
      latitude: 50.0,
      baroAltitude: 1020,
      trueTrack: 90,
      velocity: 220,
    } as FlightState,
    { tailGapMeters: 24 },
  );

  assert.ok(connector);
  const head = connector![connector!.length - 1];
  assert.ok(head[0] < aircraftLongitude);
  assert.ok(head[0] > aircraftLongitude - 0.001);
});

test("buildTrailConnector follows the recent tail arc instead of flattening against the last segment", () => {
  const connector = buildTrailConnector(
    [
      [8.0, 50.0, 1000],
      [8.01, 50.005, 1008],
      [8.02, 50.011, 1016],
      [8.03, 50.0112, 1022],
    ],
    {
      icao24: "abc123",
      longitude: 8.036,
      latitude: 50.012,
      baroAltitude: 1030,
      trueTrack: 90,
      velocity: 220,
    } as FlightState,
    { tailGapMeters: 24 },
  );

  assert.ok(connector);
  assert.ok(connector![1][1] - connector![0][1] > 0.00005);
});

test("buildTrailConnector keeps more of the requested tail gap when the aircraft is nearby", () => {
  const aircraftLongitude = 8.0303;
  const connector = buildTrailConnector(
    [
      [8.0, 50.0, 1000],
      [8.01, 50.0, 1010],
      [8.02, 50.0, 1020],
      [8.03, 50.0, 1030],
    ],
    {
      icao24: "abc123",
      longitude: aircraftLongitude,
      latitude: 50.0,
      baroAltitude: 1030,
      trueTrack: 90,
      velocity: 220,
    } as FlightState,
    { tailGapMeters: 24 },
  );

  assert.ok(connector);
  const head = connector![connector!.length - 1];
  const metersGap =
    (aircraftLongitude - head[0]) * 111_320 * Math.cos((50 * Math.PI) / 180);
  assert.ok(metersGap > 15);
});

test("buildTrailConnector never anchors the connector ahead of the aircraft when the input tail overshoots", () => {
  const aircraftLongitude = 8.1;
  const connector = buildTrailConnector(
    [
      [8.0, 50.0, 1000],
      [8.08, 50.0, 1010],
      [8.1005, 50.0, 1020],
    ],
    {
      icao24: "abc123",
      longitude: aircraftLongitude,
      latitude: 50.0,
      baroAltitude: 1020,
      trueTrack: 90,
      velocity: 220,
    } as FlightState,
    { tailGapMeters: 24 },
  );

  assert.ok(connector);
  const head = connector![connector!.length - 1];
  assert.ok(head[0] < aircraftLongitude);
});

test("connector gradient softens toward the aircraft instead of becoming more opaque", () => {
  const colors = buildConnectorGradientColors(
    [
      [8.0, 50.0, 1000],
      [8.01, 50.0, 1000],
      [8.02, 50.0, 1000],
    ],
    true,
    [255, 255, 255, 255],
  );

  assert.ok(colors[colors.length - 1][3] < colors[0][3]);
});

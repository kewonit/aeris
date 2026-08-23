import assert from "node:assert/strict";
import test from "node:test";

import { parseAircraftList } from "./flight-api-parsing";
import type { RawAircraft } from "./flight-api-types";

const LOOKUP_OPTIONS = {
  includeGround: true,
  requireBaroAltitude: false,
};

test("parses the API 2.0.0 aircraft shape with omitted optional fields", () => {
  const flights = parseAircraftList(
    [
      {
        hex: "ABC123",
        lat: 12.5,
        lon: 77.6,
        seen_pos: 0.5,
        dst: 10.2,
        dir: 245,
      },
    ],
    LOOKUP_OPTIONS,
  );

  assert.equal(flights.length, 1);
  assert.equal(flights[0].icao24, "abc123");
  assert.equal(flights[0].positionSource, null);
  assert.equal(flights[0].debugData?.messages, null);
});

test("preserves response time, position age, and provider identity", () => {
  const flights = parseAircraftList(
    [
      {
        hex: "ABC123",
        lat: 12.5,
        lon: 77.6,
        seen_pos: 1.25,
      },
    ],
    {
      ...LOOKUP_OPTIONS,
      positionProvider: "adsb.lol",
      responseTime: 1_700_000_000_000,
    },
  );

  assert.deepEqual(flights[0].provenance, {
    responseTime: 1_700_000_000_000,
    observationTime: 1_699_999_998_750,
    positionAgeSeconds: 1.25,
    contributingSources: ["adsb.lol"],
    positionProvider: "adsb.lol",
  });
});

test("skips missing, non-ICAO, and malformed hex values without throwing", () => {
  const malformed = [
    { lat: 1, lon: 2 },
    { hex: 123456, lat: 1, lon: 2 },
    { hex: "~abc12", lat: 1, lon: 2 },
    { hex: "nothex", lat: 1, lon: 2 },
  ] as unknown as RawAircraft[];

  assert.doesNotThrow(() => parseAircraftList(malformed, LOOKUP_OPTIONS));
  assert.deepEqual(parseAircraftList(malformed, LOOKUP_OPTIONS), []);
});

test("rejects invalid positions and malformed position ages", () => {
  const aircraft = [
    { hex: "abc001", lat: 91, lon: 0 },
    { hex: "abc002", lat: 0, lon: 181 },
    { hex: "abc003", lat: Number.NaN, lon: 0 },
    { hex: "abc004", lat: 0, lon: 0, seen_pos: 61 },
    { hex: "abc005", lat: 0, lon: 0, seen_pos: -1 },
    { hex: "abc006", lat: 0, lon: 0, seen_pos: "fresh" },
  ] as unknown as RawAircraft[];

  assert.deepEqual(parseAircraftList(aircraft, LOOKUP_OPTIONS), []);
});

test("never substitutes lastPosition for a missing live position", () => {
  const flights = parseAircraftList(
    [
      {
        hex: "abc123",
        lastPosition: {
          lat: 12.5,
          lon: 77.6,
          seen_pos: 120,
        },
      },
    ],
    LOOKUP_OPTIONS,
  );

  assert.deepEqual(flights, []);
});

test("malformed optional values are normalized instead of throwing", () => {
  const flights = parseAircraftList(
    [
      {
        hex: "abc123",
        lat: 12.5,
        lon: 77.6,
        flight: 123,
        r: false,
        desc: {},
        nav_modes: "autopilot",
        messages: "many",
      } as unknown as RawAircraft,
    ],
    LOOKUP_OPTIONS,
  );

  assert.equal(flights.length, 1);
  assert.equal(flights[0].callsign, null);
  assert.equal(flights[0].registration, null);
  assert.equal(flights[0].navModes, null);
  assert.equal(flights[0].debugData?.messages, null);
});

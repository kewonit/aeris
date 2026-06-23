import assert from "node:assert/strict";
import test from "node:test";

import { parseAircraftList } from "./flight-api-parsing";
import { parseStateRow } from "./opensky-parsing";
import type { RawAircraft } from "./flight-api-types";

function makeReadsbAircraft(type: string): RawAircraft {
  return {
    hex: "a1b2c3",
    type,
    flight: "TEST123",
    lat: 37.62,
    lon: -122.38,
    alt_baro: 10_000,
    gs: 250,
    track: 90,
    messages: 1,
    seen: 0,
    rssi: -10,
    mlat: [],
    tisb: [],
  };
}

function makeOpenSkyState(positionSource: number) {
  return [
    "a1b2c3",
    "TEST123 ",
    "United States",
    1_700_000_000,
    1_700_000_001,
    -122.38,
    37.62,
    10_000,
    false,
    250,
    90,
    0,
    null,
    10_100,
    null,
    false,
    positionSource,
    null,
  ];
}

test("readsb string position sources normalize to shared source labels", () => {
  assert.equal(
    parseAircraftList([makeReadsbAircraft("adsb_icao")])[0]?.positionSource,
    "adsb",
  );
  assert.equal(
    parseAircraftList([makeReadsbAircraft("mlat")])[0]?.positionSource,
    "mlat",
  );
  assert.equal(
    parseAircraftList([makeReadsbAircraft("tisb_trackfile")])[0]
      ?.positionSource,
    "tisb",
  );
  assert.equal(
    parseAircraftList([makeReadsbAircraft("adsc")])[0]?.positionSource,
    "adsc",
  );
});

test("OpenSky numeric position sources normalize to shared source labels", () => {
  assert.equal(parseStateRow(makeOpenSkyState(0))?.positionSource, "adsb");
  assert.equal(parseStateRow(makeOpenSkyState(1))?.positionSource, "asterix");
  assert.equal(parseStateRow(makeOpenSkyState(2))?.positionSource, "mlat");
  assert.equal(parseStateRow(makeOpenSkyState(3))?.positionSource, "flarm");
  assert.equal(parseStateRow(makeOpenSkyState(9))?.positionSource, "other");
});

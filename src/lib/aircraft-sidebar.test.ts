import assert from "node:assert/strict";
import test from "node:test";
import type { FlightState } from "@/lib/opensky";

import {
  aircraftVerticalRate,
  buildAircraftDetailRows,
  buildAircraftSidebarViewModel,
  describeMissingRoute,
  formatAircraftDataSources,
  formatAircraftFreshness,
  formatAircraftIdentity,
  formatAircraftName,
  hasEmergencyStatus,
  isMilitaryAircraft,
} from "./aircraft-sidebar";

test("sidebar data does not infer an operator from a country", () => {
  const view = buildAircraftSidebarViewModel(
    {
      manufacturer: null,
      model: null,
      registration: null,
      registrationCountry: "United States",
      registrationCountryFlag: "🇺🇸",
      typeCode: null,
      typeDescription: null,
    },
    null,
    null,
  );

  assert.equal(view.airline, null);
  assert.equal(view.registrationCountry, "United States");
  assert.doesNotMatch(JSON.stringify(view), /operator/i);
});

test("feed and registry fields win over photo metadata", () => {
  const view = buildAircraftSidebarViewModel(
    {
      manufacturer: "Boeing",
      model: "737-832",
      registration: "N3749D",
      registrationCountry: "United States",
      registrationCountryFlag: "🇺🇸",
      typeCode: "B738",
      typeDescription: null,
    },
    "Delta Air Lines",
    {
      manufacturer: "Photo manufacturer",
      registration: "Photo registration",
      type: "Photo type",
      typeCode: "Photo type code",
    },
  );

  assert.deepEqual(view, {
    airline: "Delta Air Lines",
    registration: "N3749D",
    registrationCountry: "United States",
    registrationCountryFlag: "🇺🇸",
    manufacturer: "Boeing",
    model: "737-832",
    typeCode: "B738",
  });
});

test("photo metadata fills fields the feed and registry lack", () => {
  const view = buildAircraftSidebarViewModel(
    {
      manufacturer: null,
      model: null,
      registration: null,
      registrationCountry: null,
      registrationCountryFlag: null,
      typeCode: null,
      typeDescription: null,
    },
    null,
    {
      manufacturer: "Boeing",
      registration: "N3749D",
      type: "737-832",
      typeCode: "B738",
    },
  );

  assert.equal(view.registration, "N3749D");
  assert.equal(view.model, "737-832");
  assert.equal(view.manufacturer, "Boeing");
  assert.equal(view.typeCode, "B738");
});

test("reads military and emergency flags", () => {
  assert.equal(isMilitaryAircraft(1), true);
  assert.equal(isMilitaryAircraft(2), false);
  assert.equal(isMilitaryAircraft(null), false);
  assert.equal(hasEmergencyStatus("general"), true);
  assert.equal(hasEmergencyStatus("none"), false);
  assert.equal(hasEmergencyStatus(null), false);
});

test("sidebar source and freshness text stays factual", () => {
  assert.deepEqual(
    formatAircraftDataSources(["adsb.lol", "faa", "adsb.lol"]),
    ["adsb.lol", "FAA"],
  );
  assert.equal(
    formatAircraftFreshness(1_000, 13_999),
    "Updated 12 seconds ago",
  );
  assert.equal(
    formatAircraftFreshness(1_000, 2_000),
    "Updated 1 second ago",
  );
});

test("names the aircraft by maker and model", () => {
  const name = (manufacturer: string | null, model: string | null, typeCode: string | null = null) =>
    formatAircraftName({ manufacturer, model, typeCode });

  assert.equal(name("BOEING", "737-8H4"), "Boeing 737-8H4");
  assert.equal(name("EMBRAER S A", "ERJ 170-200 LR"), "Embraer ERJ 170-200 LR");
  assert.equal(name(null, "Boeing 767-332"), "Boeing 767-332");
  assert.equal(name("Boeing", "Boeing 777-300ER"), "Boeing 777-300ER");
  assert.equal(name(null, null, "B763"), "B763");
  assert.equal(name(null, null), null);
});

const DETAILS = {
  airline: null,
  registration: "N834SK",
  registrationCountry: "United States",
  registrationCountryFlag: "🇺🇸",
  manufacturer: "BOMBARDIER",
  model: "CL-600-2D24",
  typeCode: "CRJ9",
};

test("an aircraft is named by callsign, then registration, then ICAO address", () => {
  const flight = { icao24: "ab68d0", callsign: " EDV5216 " };

  assert.equal(formatAircraftIdentity(flight, DETAILS), "EDV5216");
  assert.equal(
    formatAircraftIdentity({ ...flight, callsign: null }, DETAILS),
    "N834SK",
  );
  assert.equal(
    formatAircraftIdentity(
      { ...flight, callsign: "  " },
      { registration: null },
    ),
    "AB68D0",
  );
});

test("the vertical rate falls back to the GPS rate", () => {
  assert.equal(aircraftVerticalRate({ verticalRate: -5, geomRate: -6 }), -5);
  assert.equal(aircraftVerticalRate({ verticalRate: null, geomRate: -6 }), -6);
  assert.equal(aircraftVerticalRate({ verticalRate: null }), null);
});

test("a missing route says why", () => {
  assert.match(describeMissingRoute({ loading: true, mismatch: false }), /Looking/);
  assert.match(describeMissingRoute({ loading: false, mismatch: true }), /match/);
  assert.match(describeMissingRoute({ loading: false, mismatch: false }), /No route/);
});

test("detail rows come in order, without unknowns, with debug rows on request", () => {
  const flight = {
    icao24: "ab68d0",
    onGround: false,
    latitude: 40.44,
    longitude: -73.9,
    geoAltitude: null,
    tas: 250,
    squawk: "5770",
    positionSource: "adsb",
    debugData: { nacP: 9, nic: 8, version: 2 },
  } as unknown as FlightState;

  const rows = buildAircraftDetailRows(flight, DETAILS, "aviation", false);
  assert.deepEqual(
    rows.map((row) => row.key),
    [
      "icao",
      "registration",
      "country",
      "manufacturer",
      "model",
      "typeCode",
      "status",
      "position",
      "trueAirspeed",
      "squawk",
      "positionMethod",
    ],
  );
  assert.equal(rows[2].value, "🇺🇸 United States");
  assert.equal(rows[7].value, "40.44° N, 73.90° W");

  const debug = buildAircraftDetailRows(flight, DETAILS, "aviation", true);
  assert.deepEqual(
    debug.slice(-3).map((row) => [row.label, row.value]),
    [
      ["NACp", "9"],
      ["NIC", "8"],
      ["ADS-B version", "2"],
    ],
  );
});

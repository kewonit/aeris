import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAircraftSidebarViewModel,
  formatAircraftDataSources,
  formatAircraftFreshness,
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

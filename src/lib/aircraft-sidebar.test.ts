import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAircraftSidebarViewModel,
  formatAircraftDataSources,
  formatAircraftFreshness,
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

test("sidebar data includes only supported identity fields", () => {
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
      manufacturer: "Unsupported fallback",
      registration: "Unsupported fallback",
      type: "Unsupported fallback",
      typeCode: "Unsupported fallback",
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

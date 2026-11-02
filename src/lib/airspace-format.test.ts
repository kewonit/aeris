import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAirspaceLimit, formatAirspaceTitle } from "./airspace-format";

test("formatAirspaceLimit returns GND for GND reference with 0 value", () => {
  assert.equal(
    formatAirspaceLimit({ value: 0, unit: "ft", referenceDatum: "GND" }),
    "GND",
  );
});

test("formatAirspaceLimit returns FLnnn for STD reference", () => {
  assert.equal(
    formatAirspaceLimit({ value: 245, unit: "ft", referenceDatum: "STD" }),
    "FL245",
  );
});

test("formatAirspaceLimit returns 'value unit datum' for AMSL/AGL", () => {
  assert.equal(
    formatAirspaceLimit({ value: 2500, unit: "ft", referenceDatum: "AMSL" }),
    "2500 ft AMSL",
  );
  assert.equal(
    formatAirspaceLimit({ value: 1000, unit: "m", referenceDatum: "AGL" }),
    "1000 m AGL",
  );
});

test("formatAirspaceLimit falls back to '-' on null/undefined inputs", () => {
  assert.equal(formatAirspaceLimit(null), "-");
  assert.equal(formatAirspaceLimit(undefined), "-");
  assert.equal(
    formatAirspaceLimit({
      value: null as unknown as number,
      unit: "ft",
      referenceDatum: "AMSL",
    }),
    "-",
  );
});

test("formatAirspaceTitle names the class when classified", () => {
  assert.deepEqual(
    formatAirspaceTitle({ icao_class: "c", type: "other", name: "LHR TMA" }),
    { kind: "Class C", name: "LHR TMA" },
  );
});

test("formatAirspaceTitle falls back to the type when unclassified", () => {
  assert.deepEqual(
    formatAirspaceTitle({
      icao_class: "unclassified",
      type: "restricted",
      name: "R-2508",
    }),
    { kind: "Restricted", name: "R-2508" },
  );
});

test("formatAirspaceTitle has no name line without a name", () => {
  assert.deepEqual(
    formatAirspaceTitle({ icao_class: "unclassified", type: "tfr", name: "" }),
    { kind: "TFR", name: null },
  );
});

test("formatAirspaceLimit treats SFC like GND for value 0", () => {
  assert.equal(
    formatAirspaceLimit({ value: 0, unit: "ft", referenceDatum: "SFC" }),
    "SFC",
  );
});

test("formatAirspaceLimit rejects non-numeric value and NaN/Infinity", () => {
  assert.equal(
    formatAirspaceLimit({
      value: NaN,
      unit: "ft",
      referenceDatum: "AMSL",
    }),
    "-",
  );
  assert.equal(
    formatAirspaceLimit({
      value: Infinity,
      unit: "ft",
      referenceDatum: "AMSL",
    }),
    "-",
  );
});

test("formatAirspaceLimit returns '-' when unit or datum missing (non-STD)", () => {
  assert.equal(
    formatAirspaceLimit({ value: 100, unit: "", referenceDatum: "AMSL" }),
    "-",
  );
  assert.equal(
    formatAirspaceLimit({ value: 100, unit: "ft", referenceDatum: "" }),
    "-",
  );
});

test("formatAirspaceTitle handles whitespace-only name and mixed-case unclassified", () => {
  assert.deepEqual(
    formatAirspaceTitle({
      icao_class: "UNCLASSIFIED",
      type: "tfr",
      name: "   ",
    }),
    { kind: "TFR", name: null },
  );
  assert.deepEqual(
    formatAirspaceTitle({
      icao_class: "  c  ",
      type: "other",
      name: "  LHR TMA  ",
    }),
    { kind: "Class C", name: "LHR TMA" },
  );
});

test("formatAirspaceTitle handles missing/nullish icao_class gracefully", () => {
  assert.deepEqual(
    formatAirspaceTitle({
      icao_class: "",
      type: "restricted",
      name: "R-2508",
    }),
    { kind: "Restricted", name: "R-2508" },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import {
  compactAircraftRecord,
  createAircraftChunks,
  iterateCsvRows,
  mergeFaaAircraft,
  normalizeAirports,
  normalizeMictronicsAircraft,
  registrationCountryCode,
  validateCountChange,
} from "./lib";

test("parses quoted CSV fields and line endings", () => {
  const rows = [...iterateCsvRows('A,B\r\n1,"two, too"\r\n')];
  assert.deepEqual(rows, [
    ["A", "B"],
    ["1", "two, too"],
  ]);
});

test("merges safe FAA fields without owner data", () => {
  const mictronics = zipSync({
    "a0.json": strToU8(
      JSON.stringify({
        "04b3": { r: "N100", t: "C172", f: "00", desc: "172K" },
      }),
    ),
  });
  const aircraft = normalizeMictronicsAircraft(mictronics, 1);
  const faa = zipSync({
    "ACFTREF.txt": strToU8(
      "CODE,MFR,MODEL\r\n7100510,CESSNA,172K\r\n",
    ),
    "MASTER.txt": strToU8(
      [
        "N-NUMBER,MFR MDL CODE,MODE S CODE HEX,NAME,STREET,CITY,STATE,ZIP CODE",
        "100,7100510,A004B3,OWNER ONE,10 PRIVATE ROAD,CITY,ST,00000",
      ].join("\r\n"),
    ),
  });

  assert.equal(mergeFaaAircraft(faa, aircraft, 1), 1);
  const record = aircraft.get("a004b3");
  assert.ok(record);
  assert.deepEqual(compactAircraftRecord(record), [
    "N100",
    "C172",
    "172K",
    "CESSNA",
    "US",
    "00",
    3,
  ]);
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /OWNER ONE|PRIVATE ROAD|00000/);
});

test("normalizes active airports and excludes closed airports", () => {
  const csv = [
    "ID,IDENT,TYPE,NAME,LATITUDE_DEG,LONGITUDE_DEG,ELEVATION_FT,ISO_COUNTRY,MUNICIPALITY,ICAO_CODE,IATA_CODE",
    '2,TEST,small_airport,"Test, Regional",12.5,77.6,100,IN,Bengaluru,VOTX,TST',
    "3,CLOSED,closed,Closed Airport,10,20,,IN,,,",
  ].join("\n");

  assert.deepEqual(normalizeAirports(csv, 1), [
    {
      id: 2,
      ident: "TEST",
      type: "small_airport",
      name: "Test, Regional",
      latitude: 12.5,
      longitude: 77.6,
      elevationFt: 100,
      countryCode: "IN",
      municipality: "Bengaluru",
      icao: "VOTX",
      iata: "TST",
    },
  ]);
});

test("maps common registrations to country codes", () => {
  assert.equal(registrationCountryCode("N100"), "US");
  assert.equal(registrationCountryCode("VT-ABC"), "IN");
  assert.equal(registrationCountryCode("ZS-ABC"), "ZA");
  assert.equal(registrationCountryCode("unknown"), null);
});

test("rejects a record count drop above ten percent", () => {
  assert.doesNotThrow(() => validateCountChange("Aircraft", 100, 90));
  assert.throws(
    () => validateCountChange("Aircraft", 100, 89),
    /record count fell/,
  );
});

test("creates all aircraft chunks in deterministic order", () => {
  const aircraft = new Map([
    [
      "ff0001",
      {
        icao24: "ff0001",
        registration: "TEST2",
        typeCode: null,
        model: null,
        manufacturer: null,
        registrationCountryCode: null,
        databaseFlags: null,
        sourceMask: 1,
      },
    ],
    [
      "000001",
      {
        icao24: "000001",
        registration: "TEST1",
        typeCode: null,
        model: null,
        manufacturer: null,
        registrationCountryCode: null,
        databaseFlags: null,
        sourceMask: 1,
      },
    ],
  ]);

  const first = createAircraftChunks(aircraft);
  const second = createAircraftChunks(new Map([...aircraft].reverse()));
  assert.equal(first.size, 256);
  assert.deepEqual([...first.keys()].slice(0, 3), ["00", "01", "02"]);
  assert.deepEqual([...first.keys()].slice(-2), ["fe", "ff"]);
  assert.equal(JSON.stringify([...first]), JSON.stringify([...second]));
});

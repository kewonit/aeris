import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import {
  createAircraftChunks,
  iterateCsvRows,
  mergeFaaAircraft,
  normalizeMictronicsAircraft,
  validateCountChange,
  type NormalizedAircraftRecord,
} from "./lib";

function mictronicsArchive(files: Record<string, unknown>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [
        name,
        strToU8(JSON.stringify(value)),
      ]),
    ),
  );
}

function faaArchive(master: string[]): Uint8Array {
  return zipSync({
    "ACFTREF.txt": strToU8("CODE,MFR,MODEL\r\n7100510,CESSNA,172K\r\n"),
    "MASTER.txt": strToU8(
      [
        "N-NUMBER,MFR MDL CODE,MODE S CODE HEX,NAME,STREET,CITY,STATE,ZIP CODE",
        ...master,
      ].join("\r\n"),
    ),
  });
}

function record(icao24: string): NormalizedAircraftRecord {
  return {
    icao24,
    registration: null,
    typeCode: null,
    model: null,
    manufacturer: null,
    databaseFlags: null,
    sourceMask: 1,
  };
}

test("parses quoted CSV fields, embedded newlines, and line endings", () => {
  const rows = [...iterateCsvRows('A,B\r\n1,"two, ""too""\nthree"\r\n')];
  assert.deepEqual(rows, [
    ["A", "B"],
    ["1", 'two, "too"\nthree'],
  ]);
});

test("reads nested Mictronics prefix files and skips child indexes", () => {
  const aircraft = normalizeMictronicsAircraft(
    mictronicsArchive({
      "A.json": { children: ["A0"], "00001": { r: "n1", t: "c172" } },
      "A0.json": { "0002": { r: "N2", desc: "Skyhawk" } },
    }),
    1,
  );
  assert.deepEqual([...aircraft.keys()], ["a00001", "a00002"]);
  assert.equal(aircraft.get("a00001")?.registration, "N1");
  assert.equal(aircraft.get("a00001")?.typeCode, "C172");
  assert.equal(aircraft.get("a00002")?.model, "Skyhawk");
});

test("FAA registration and model replace Mictronics values", () => {
  const aircraft = normalizeMictronicsAircraft(
    mictronicsArchive({
      "a0.json": { "04b3": { r: "N999ZZ", t: "C172", f: "00", desc: "Old" } },
    }),
    1,
  );
  mergeFaaAircraft(
    faaArchive(["100,7100510,A004B3,OWNER ONE,10 PRIVATE ROAD,CITY,ST,00000"]),
    aircraft,
    1,
  );

  assert.deepEqual(aircraft.get("a004b3"), {
    icao24: "a004b3",
    registration: "N100",
    typeCode: "C172",
    model: "172K",
    manufacturer: "CESSNA",
    databaseFlags: "00",
    sourceMask: 3,
  });
});

test("FAA rows never copy owner or address columns", () => {
  const aircraft = new Map<string, NormalizedAircraftRecord>();
  mergeFaaAircraft(
    faaArchive(["100,7100510,A004B3,OWNER ONE,10 PRIVATE ROAD,CITY,ST,00000"]),
    aircraft,
    1,
  );
  const serialized = JSON.stringify([...aircraft.values()]);
  assert.doesNotMatch(serialized, /OWNER ONE|PRIVATE ROAD|00000/);
});

test("rejects a record count drop above ten percent", () => {
  assert.doesNotThrow(() => validateCountChange("Aircraft", 100, 90));
  assert.throws(
    () => validateCountChange("Aircraft", 100, 89),
    /record count fell/,
  );
});

test("splits only buckets above the threshold, in sorted order", () => {
  const aircraft = new Map(
    ["ff0001", "a01000", "a00001", "a00002", "000001"].map((icao24) => [
      icao24,
      record(icao24),
    ]),
  );

  const chunks = createAircraftChunks(aircraft, 2);
  assert.deepEqual([...chunks.keys()], ["00", "a00", "a01", "ff"]);
  assert.deepEqual(Object.keys(chunks.get("a00")!.records), [
    "a00001",
    "a00002",
  ]);

  const reversed = createAircraftChunks(new Map([...aircraft].reverse()), 2);
  assert.equal(JSON.stringify([...chunks]), JSON.stringify([...reversed]));
});

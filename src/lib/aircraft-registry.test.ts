import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAircraftRegistryCacheForTests,
  lookupAircraftRegistry,
} from "./aircraft-registry";

test("loads and expands one registry chunk", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestCount++;
    assert.equal(String(input), "/data/aviation/aircraft/a0.json");
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        records: {
          a004b3: ["N100", "C172", "172K", "CESSNA", "US", "00", 3],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  clearAircraftRegistryCacheForTests();

  try {
    const first = await lookupAircraftRegistry("A004B3");
    const second = await lookupAircraftRegistry("a004b3");
    assert.deepEqual(first, {
      icao24: "a004b3",
      registration: "N100",
      typeCode: "C172",
      model: "172K",
      manufacturer: "CESSNA",
      registrationCountry: "United States",
      registrationCountryCode: "US",
      registrationCountryFlag: "🇺🇸",
      databaseFlags: "00",
      sources: ["faa", "mictronics"],
    });
    assert.deepEqual(second, first);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearAircraftRegistryCacheForTests();
  }
});

test("rejects invalid addresses without a request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("Unexpected request");
  }) as typeof fetch;
  clearAircraftRegistryCacheForTests();

  try {
    assert.equal(await lookupAircraftRegistry("invalid"), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearAircraftRegistryCacheForTests();
  }
});

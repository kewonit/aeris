import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAircraftRegistryCacheForTests,
  lookupAircraftRegistry,
} from "./aircraft-registry";

type Routes = Record<string, () => Response>;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(
  routes: Routes,
  run: (requests: string[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    const route = routes[url];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return route();
  }) as typeof fetch;
  clearAircraftRegistryCacheForTests();
  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    clearAircraftRegistryCacheForTests();
  }
}

const INDEX = "/data/aviation/aircraft/index.json";

test("resolves an address through the index to its split chunk", async () => {
  await withFetch(
    {
      [INDEX]: () => json({ schemaVersion: 2, chunks: ["a00", "a01", "89"] }),
      "/data/aviation/aircraft/a00.json": () =>
        json({
          schemaVersion: 2,
          records: { a004b3: ["N100", "C172", "172K", "CESSNA", "00", 3] },
        }),
    },
    async (requests) => {
      const first = await lookupAircraftRegistry("A004B3");
      const second = await lookupAircraftRegistry("a004b3");
      assert.deepEqual(first, {
        icao24: "a004b3",
        registration: "N100",
        typeCode: "C172",
        model: "172K",
        manufacturer: "CESSNA",
        registrationCountry: "United States",
        registrationCountryFlag: "🇺🇸",
        databaseFlags: "00",
        sources: ["faa", "mictronics"],
      });
      assert.deepEqual(second, first);
      assert.deepEqual(requests, [INDEX, "/data/aviation/aircraft/a00.json"]);
    },
  );
});

test("derives the registration country from the registration", async () => {
  await withFetch(
    {
      [INDEX]: () => json({ schemaVersion: 2, chunks: ["89"] }),
      "/data/aviation/aircraft/89.json": () =>
        json({
          schemaVersion: 2,
          records: { "899000": ["B-18901", "A359", null, null, "00", 1] },
        }),
    },
    async () => {
      const record = await lookupAircraftRegistry("899000");
      assert.equal(record?.registrationCountry, "Taiwan");
      assert.equal(record?.registrationCountryFlag, "🇹🇼");
    },
  );
});

test("skips the chunk request for an address outside the index", async () => {
  await withFetch(
    { [INDEX]: () => json({ schemaVersion: 2, chunks: ["89"] }) },
    async (requests) => {
      assert.equal(await lookupAircraftRegistry("000001"), null);
      assert.deepEqual(requests, [INDEX]);
    },
  );
});

test("retries the index after a failed request", async () => {
  let failures = 1;
  await withFetch(
    {
      [INDEX]: () =>
        failures-- > 0
          ? new Response("", { status: 503 })
          : json({ schemaVersion: 2, chunks: [] }),
    },
    async (requests) => {
      await assert.rejects(lookupAircraftRegistry("899000"), /HTTP 503/);
      assert.equal(await lookupAircraftRegistry("899000"), null);
      assert.equal(requests.length, 2);
    },
  );
});

test("rejects invalid addresses without a request", async () => {
  await withFetch({}, async (requests) => {
    assert.equal(await lookupAircraftRegistry("invalid"), null);
    assert.deepEqual(requests, []);
  });
});

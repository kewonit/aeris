import assert from "node:assert/strict";
import test from "node:test";

// We must reset the module cache between tests because search-flight-client
// holds module-level state (cache Map).
async function importFresh() {
  const key = require.resolve("./search-flight-client");
  delete require.cache[key];
  return import("./search-flight-client");
}

test("searchFlightsGlobal tries hex then callsign for 6-char hex-like query", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("hex")) {
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    }
    if (url.includes("callsign")) {
      return new Response(
        JSON.stringify({
          ac: [
            {
              hex: "a1b2c3",
              flight: "AA1234 ",
              lat: 40.7,
              lon: -74.0,
              alt_baro: 30000,
              gs: 450,
              track: 90,
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const results = await searchFlightsGlobal("AA1234");
    assert.equal(results.length, 1);
    assert.equal(results[0].icao24, "a1b2c3");
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes("hex"));
    assert.ok(calls[1].includes("callsign"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchFlightsGlobal tries callsign variants then hex for non-hex query", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("callsign")) {
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    }
    if (url.includes("hex")) {
      return new Response(
        JSON.stringify({
          ac: [
            {
              hex: "abc123",
              flight: "IX2680 ",
              lat: 51.5,
              lon: -0.1,
              alt_baro: 25000,
              gs: 400,
              track: 180,
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const results = await searchFlightsGlobal("IX2680");
    assert.equal(results.length, 1);
    assert.equal(results[0].icao24, "abc123");
    // Should try callsign variants first (IX2680, AXB2680) then hex fallback
    assert.ok(calls.length >= 2);
    assert.ok(calls[0].includes("callsign"));
    assert.ok(calls[calls.length - 1].includes("hex"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchFlightsGlobal returns empty on total failure without throwing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: "bad" }), { status: 502 });
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const results = await searchFlightsGlobal("ZZ999");
    assert.equal(results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchFlightsGlobal uses cache on repeat query", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    return new Response(
      JSON.stringify({
        ac: [
          {
            hex: "deadbf",
            flight: "DEADBF ",
            lat: 0,
            lon: 0,
            alt_baro: 10000,
            gs: 300,
            track: 0,
          },
        ],
      }),
      { status: 200 },
    );
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const r1 = await searchFlightsGlobal("DEADBF");
    assert.equal(r1.length, 1);
    assert.equal(callCount, 1);

    const r2 = await searchFlightsGlobal("DEADBF");
    assert.equal(r2.length, 1);
    assert.equal(callCount, 1); // cache hit, no extra fetch
  } finally {
    globalThis.fetch = originalFetch;
  }
});

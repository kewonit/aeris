import assert from "node:assert/strict";
import test from "node:test";

async function importFresh() {
  const key = require.resolve("./search-flight-client");
  delete require.cache[key];
  return import("./search-flight-client");
}

test("searchFlightsGlobal finds AXB2680 when user searches IX2680", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("hex")) {
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    }
    if (url.includes("IX2680")) {
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    }
    if (url.includes("AXB2680")) {
      return new Response(
        JSON.stringify({
          ac: [
            {
              hex: "801673",
              flight: "AXB2680 ",
              lat: 12.9,
              lon: 80.1,
              alt_baro: 32000,
              gs: 430,
              track: 85,
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
    assert.equal(results[0].icao24, "801673");
    assert.ok(calls.some((c) => c.includes("AXB2680")), "must query AXB2680 callsign");
    assert.ok(calls.some((c) => c.includes("IX2680")), "must query IX2680 callsign");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchFlightsGlobal finds AXB2680 when user searches AXB2680", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("hex")) {
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    }
    if (url.includes("AXB2680")) {
      return new Response(
        JSON.stringify({
          ac: [
            {
              hex: "801673",
              flight: "AXB2680 ",
              lat: 12.9,
              lon: 80.1,
              alt_baro: 32000,
              gs: 430,
              track: 85,
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ac: [] }), { status: 200 });
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const results = await searchFlightsGlobal("AXB2680");
    assert.equal(results.length, 1);
    assert.equal(results[0].icao24, "801673");
    assert.ok(calls.some((c) => c.includes("AXB2680")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchFlightsGlobal finds AAL1234 when user searches AA1234", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("hex")) {
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    }
    if (url.includes("AA1234")) {
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    }
    if (url.includes("AAL1234")) {
      return new Response(
        JSON.stringify({
          ac: [
            {
              hex: "aabbcc",
              flight: "AAL1234 ",
              lat: 33.9,
              lon: -118.4,
              alt_baro: 25000,
              gs: 400,
              track: 270,
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ac: [] }), { status: 200 });
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const results = await searchFlightsGlobal("AA1234");
    assert.equal(results.length, 1);
    assert.equal(results[0].icao24, "aabbcc");
    assert.ok(calls.some((c) => c.includes("AAL1234")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

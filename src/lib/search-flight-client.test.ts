import assert from "node:assert/strict";
import test from "node:test";
import { resetAllCircuits } from "./flight-api-client";

// We must reset the module cache between tests because search-flight-client
// holds module-level state (cache Map).
async function importFresh() {
  const key = require.resolve("./search-flight-client");
  delete require.cache[key];
  return import("./search-flight-client");
}

function readsbBody(ac: unknown[]): string {
  return JSON.stringify({ ac, msg: "No error", now: 1, total: ac.length });
}

test("searchFlightsGlobal tries hex then callsign for 6-char hex-like query", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("hex")) {
      return new Response(readsbBody([]), { status: 200 });
    }
    if (url.includes("callsign")) {
      return new Response(
        readsbBody([
          {
            hex: "a1b2c3",
            flight: "AA1234 ",
            lat: 40.7,
            lon: -74.0,
            alt_baro: 30000,
            gs: 450,
            track: 90,
          },
        ]),
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
    assert.equal(calls.length, 4);
    assert.ok(calls[0].includes("hex"));
    assert.ok(calls[3].includes("callsign"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchFlightsGlobal tries callsign variants for a non-hex query", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("AXB2680") && url.includes("provider=adsb")) {
      return new Response(
        readsbBody([
          {
            hex: "abc123",
            flight: "AXB2680 ",
            lat: 51.5,
            lon: -0.1,
            alt_baro: 25000,
            gs: 400,
            track: 180,
          },
        ]),
        { status: 200 },
      );
    }
    if (url.includes("callsign")) {
      return new Response(readsbBody([]), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const results = await searchFlightsGlobal("IX2680");
    assert.equal(results.length, 1);
    assert.equal(results[0].icao24, "abc123");
    // Should try the user-entered callsign and its ICAO airline-code variant.
    assert.ok(calls.length >= 2);
    assert.ok(calls[0].includes("callsign"));
    assert.ok(calls.some((call) => call.includes("AXB2680")));
    assert.ok(calls.every((call) => !call.includes("%2Fhex%2F")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchFlightsGlobal returns empty on total failure without throwing", async () => {
  resetAllCircuits();
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
  resetAllCircuits();
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    return new Response(
      readsbBody([
        {
          hex: "deadbf",
          flight: "DEADBF ",
          lat: 0,
          lon: 0,
          alt_baro: 10000,
          gs: 300,
          track: 0,
        },
      ]),
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

test("search cache is scoped to the effective provider override", async () => {
  resetAllCircuits();
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { search: "?provider=adsb" };
  let callCount = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location, addEventListener: () => {} },
  });
  globalThis.fetch = async (input: RequestInfo | URL) => {
    callCount++;
    const provider = input.toString().includes("provider=airplanes")
      ? "AIR"
      : "ADSB";
    return new Response(
      readsbBody([
        {
          hex: "abcdef",
          flight: provider,
          lat: 1,
          lon: 2,
          alt_baro: 10_000,
        },
      ]),
      { status: 200 },
    );
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    assert.equal((await searchFlightsGlobal("abcdef"))[0]?.callsign, "ADSB");
    location.search = "?provider=airplanes";
    assert.equal((await searchFlightsGlobal("abcdef"))[0]?.callsign, "AIR");
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as typeof globalThis & { window?: unknown }).window;
    }
  }
});

test("global search falls back from adsb.lol to airplanes.live", async () => {
  resetAllCircuits();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    if (url.includes("provider=adsb")) {
      return new Response(readsbBody([]), { status: 200 });
    }
    if (url.includes("provider=airplanes")) {
      return new Response(
        readsbBody([
          {
            hex: "abc123",
            flight: "BAW123 ",
            lat: 51.5,
            lon: -0.1,
            alt_baro: 25_000,
          },
        ]),
        { status: 200 },
      );
    }
    return new Response(null, { status: 502 });
  };

  try {
    const { searchFlightsGlobal, clearFlightSearchCache } = await importFresh();
    clearFlightSearchCache();
    const results = await searchFlightsGlobal("BAW123");
    assert.equal(results[0]?.icao24, "abc123");
    assert.match(calls[0], /provider=adsb/);
    assert.match(calls[1], /provider=airplanes/);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

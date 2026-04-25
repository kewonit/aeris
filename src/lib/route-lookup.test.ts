import assert from "node:assert/strict";
import test from "node:test";

import { clearRouteCache, lookupRoute } from "./route-lookup";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("lookupRoute fetches route data through the internal route API", async () => {
  clearRouteCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url === "/api/routes?callsign=UAL123") {
      return jsonResponse({
        callsign: "UAL123",
        origin: {
          iata: "SFO",
          icao: "KSFO",
          name: "San Francisco International Airport",
          municipality: "San Francisco",
          countryIso: "US",
          latitude: 37.618999,
          longitude: -122.375,
        },
        destination: {
          iata: "LHR",
          icao: "EGLL",
          name: "London Heathrow Airport",
          municipality: "London",
          countryIso: "GB",
          latitude: 51.4706,
          longitude: -0.461941,
        },
        source: "adsbdb",
        fetchedAt: 1_779_840_000_000,
      });
    }

    return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
  }) as typeof fetch;

  try {
    const route = await lookupRoute("ual123");

    assert.equal(route?.source, "adsbdb");
    assert.equal(route?.origin?.iata, "SFO");
    assert.equal(route?.destination?.iata, "LHR");
    assert.deepEqual(urls, ["/api/routes?callsign=UAL123"]);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
});

test("lookupRoute caches internal route API misses", async () => {
  clearRouteCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestCount += 1;

    if (url === "/api/routes?callsign=NOPE123") {
      return jsonResponse({ error: "Route unavailable" }, { status: 404 });
    }

    return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
  }) as typeof fetch;

  try {
    const first = await lookupRoute("NOPE123");
    const second = await lookupRoute("NOPE123");

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
});

test("lookupRoute does not cache temporary route API failures", async () => {
  clearRouteCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async () => {
    requestCount += 1;
    return jsonResponse(
      { error: "Route lookup temporarily unavailable" },
      { status: 503 },
    );
  }) as typeof fetch;

  try {
    const first = await lookupRoute("UAL790");
    const second = await lookupRoute("UAL790");

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
});

test("lookupRoute does not cache malformed route API success bodies", async () => {
  clearRouteCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async () => {
    requestCount += 1;
    return jsonResponse({ callsign: "UAL791", source: "adsbdb" });
  }) as typeof fetch;

  try {
    const first = await lookupRoute("UAL791");
    const second = await lookupRoute("UAL791");

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
});

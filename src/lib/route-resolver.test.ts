import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRouteResolverCache,
  resolveRouteFromOpenDatabases,
} from "./route-resolver";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("resolveRouteFromOpenDatabases uses direct hexdb fallback after adsbdb misses", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({ response: "unknown callsign" }, { status: 404 });
    }

    if (url === "https://hexdb.io/api/v1/route/icao/UAL123") {
      return jsonResponse({ flight: "UAL123", route: "KSFO-EGLL" });
    }

    if (url === "https://hexdb.io/api/v1/airport/icao/KSFO") {
      return jsonResponse({
        airport: "San Francisco International Airport",
        country_code: "US",
        iata: "SFO",
        icao: "KSFO",
        latitude: 37.618999,
        longitude: -122.375,
      });
    }

    if (url === "https://hexdb.io/api/v1/airport/icao/EGLL") {
      return jsonResponse({
        airport: "London Heathrow Airport",
        country_code: "GB",
        iata: "LHR",
        icao: "EGLL",
        latitude: 51.4706,
        longitude: -0.461941,
      });
    }

    return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
  }) as typeof fetch;

  try {
    const route = await resolveRouteFromOpenDatabases("UAL123");

    assert.equal(route?.source, "hexdb");
    assert.equal(route?.origin?.iata, "SFO");
    assert.equal(route?.destination?.iata, "LHR");
    assert.ok(urls.includes("https://hexdb.io/api/v1/route/icao/UAL123"));
    assert.ok(!urls.some((url) => url.startsWith("/api/hexdb?path=route")));
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("resolveRouteFromOpenDatabases returns null when both open route databases miss", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({ response: "unknown callsign" }, { status: 404 });
    }

    if (url === "https://hexdb.io/api/v1/route/icao/UAL456") {
      return jsonResponse(
        { status: "404", error: "Route not found." },
        { status: 404 },
      );
    }

    return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
  }) as typeof fetch;

  try {
    const route = await resolveRouteFromOpenDatabases("UAL456");

    assert.equal(route, null);
    assert.ok(urls.includes("https://hexdb.io/api/v1/route/icao/UAL456"));
    assert.ok(!urls.some((url) => url.startsWith("/api/hexdb")));
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("resolveRouteFromOpenDatabases caches provider 404 misses", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestCount += 1;

    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({ response: "unknown callsign" }, { status: 404 });
    }

    if (url === "https://hexdb.io/api/v1/route/icao/UAL457") {
      return jsonResponse(
        { status: "404", error: "Route not found." },
        { status: 404 },
      );
    }

    return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
  }) as typeof fetch;

  try {
    const first = await resolveRouteFromOpenDatabases("UAL457");
    const second = await resolveRouteFromOpenDatabases("UAL457");

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("resolveRouteFromOpenDatabases does not cache transient provider failures", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async () => {
    requestCount += 1;
    throw new TypeError("temporary network failure");
  }) as typeof fetch;

  try {
    const first = await resolveRouteFromOpenDatabases("UAL458");
    const second = await resolveRouteFromOpenDatabases("UAL458");

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(requestCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

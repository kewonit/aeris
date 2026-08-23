import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRouteCache,
  lookupRoute,
  routeCacheKey,
  type RouteRequest,
} from "./route-lookup";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function request(
  callsign = "UAL123",
  observationTime = 1_700_000_000_000,
): RouteRequest {
  return {
    callsign,
    icao24: "abc123",
    latitude: 37.7,
    longitude: -122.4,
    altitudeMeters: 3_000,
    onGround: false,
    observationTime,
  };
}

function responseBody(input: RouteRequest) {
  return {
    callsign: input.callsign,
    icao24: input.icao24,
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
    sources: ["adsbdb", "opensky"],
    validation: "valid",
    validatedAt: 1_779_840_000_100,
    fetchedAt: 1_779_840_000_000,
  };
}

test("lookupRoute sends bounded aircraft context to the internal API", async () => {
  clearRouteCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  const input = request();
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return jsonResponse(responseBody(input));
  }) as typeof fetch;

  try {
    const route = await lookupRoute(input);
    assert.equal(route?.source, "adsbdb");
    assert.deepEqual(route?.sources, ["adsbdb", "opensky"]);
    assert.equal(route?.validation, "valid");
    const query = new URL(urls[0], "https://aeris.example").searchParams;
    assert.equal(query.get("callsign"), "UAL123");
    assert.equal(query.get("icao24"), "abc123");
    assert.equal(query.get("latitude"), "37.7");
    assert.equal(query.get("longitude"), "-122.4");
    assert.equal(query.get("altitudeMeters"), "3000");
    assert.equal(query.get("onGround"), "0");
    assert.equal(query.get("observationTime"), "1700000000000");
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
});

test("route cache keys include hex, callsign, and six-hour bucket", () => {
  const first = request("UAL123", 1_700_000_000_000);
  const sameBucket = request("UAL123", first.observationTime + 60_000);
  const nextBucket = request("UAL123", first.observationTime + 6 * 60 * 60_000);
  assert.equal(routeCacheKey(first), routeCacheKey(sameBucket));
  assert.notEqual(routeCacheKey(first), routeCacheKey(nextBucket));
  assert.notEqual(routeCacheKey(first), routeCacheKey({ ...first, icao24: "def456" }));
});

test("lookupRoute caches internal route API misses", async () => {
  clearRouteCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount++;
    return jsonResponse({ error: "Route unavailable" }, { status: 404 });
  }) as typeof fetch;

  try {
    const input = request("NOPE123");
    assert.equal(await lookupRoute(input), null);
    assert.equal(await lookupRoute(input), null);
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
    requestCount++;
    return jsonResponse(
      { error: "Route lookup temporarily unavailable" },
      { status: 503 },
    );
  }) as typeof fetch;

  try {
    const input = request("UAL790");
    assert.equal(await lookupRoute(input), null);
    assert.equal(await lookupRoute(input), null);
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
});

test("lookupRoute treats malformed success bodies as temporary misses", async () => {
  clearRouteCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount++;
    return requestCount === 1
      ? new Response("", { status: 201 })
      : new Response("<html>wait</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
  }) as typeof fetch;

  try {
    const input = request("UAL791");
    assert.equal(await lookupRoute(input), null);
    assert.equal(await lookupRoute(input), null);
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
});

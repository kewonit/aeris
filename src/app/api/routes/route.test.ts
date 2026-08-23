import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("GET rejects invalid callsigns without touching upstream providers", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamTouched = false;
  globalThis.fetch = (async () => {
    upstreamTouched = true;
    return jsonResponse({});
  }) as typeof fetch;

  try {
    const routeModule = await import("./route");
    const request = new NextRequest(
      "https://aeris.edbn.me/api/routes?callsign=../../EGLL",
    );

    const response = await routeModule.GET(request);
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(body.error, "Invalid or missing route context");
    assert.equal(upstreamTouched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET returns normalized route data with shared-cache headers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "https://api.adsbdb.com/v0/callsign/AAL789") {
      return jsonResponse({
        response: {
          flightroute: {
            origin: {
              country_iso_name: "US",
              iata_code: "SFO",
              icao_code: "KSFO",
              latitude: 37.618999,
              longitude: -122.375,
              municipality: "San Francisco",
              name: "San Francisco International Airport",
            },
            destination: {
              country_iso_name: "GB",
              iata_code: "LHR",
              icao_code: "EGLL",
              latitude: 51.4706,
              longitude: -0.461941,
              municipality: "London",
              name: "London Heathrow Airport",
            },
          },
        },
      });
    }

    return jsonResponse({ response: "unknown callsign" }, { status: 404 });
  }) as typeof fetch;

  try {
    const routeModule = await import("./route");
    const request = new NextRequest(
      "https://aeris.edbn.me/api/routes?callsign=aal789&icao24=abc123&latitude=37.7&longitude=-122.4&altitudeMeters=10000&onGround=0&observationTime=1700000000000",
    );

    const response = await routeModule.GET(request);
    const route = (await response.json()) as {
      callsign?: string;
      source?: string;
      sources?: string[];
      validation?: string;
      icao24?: string;
      origin?: { iata?: string };
      destination?: { iata?: string };
    };

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("Cache-Control"),
      "public, max-age=300, s-maxage=300, stale-while-revalidate=300",
    );
    assert.equal(route.callsign, "AAL789");
    assert.equal(route.source, "adsbdb");
    assert.deepEqual(route.sources, ["adsbdb"]);
    assert.equal(route.validation, "valid");
    assert.equal(route.icao24, "abc123");
    assert.equal(route.origin?.iata, "SFO");
    assert.equal(route.destination?.iata, "LHR");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET does not cache transient provider failures as route misses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("temporary provider outage");
  }) as typeof fetch;

  try {
    const routeModule = await import("./route");
    const request = new NextRequest(
      "https://aeris.edbn.me/api/routes?callsign=ual790&icao24=abc123&latitude=37.7&longitude=-122.4&altitudeMeters=10000&onGround=0&observationTime=1700000000000",
    );

    const response = await routeModule.GET(request);
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(body.error, "Route lookup temporarily unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

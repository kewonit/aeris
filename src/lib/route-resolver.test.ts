import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRouteResolverCache,
  resolveReportedRoutes,
} from "./route-resolver";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function firstRoute(callsign: string) {
  return (await resolveReportedRoutes(callsign)).routes[0] ?? null;
}

test("uses direct hexdb fallback after adsbdb misses", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({ response: "unknown callsign" }, { status: 404 });
    }

    if (url.includes("opensky-network.org")) {
      return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
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
    const route = await firstRoute("UAL123");

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

test("returns null when all route databases miss", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({ response: "unknown callsign" }, { status: 404 });
    }

    if (url.includes("opensky-network.org")) {
      return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
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
    const route = await firstRoute("UAL456");

    assert.equal(route, null);
    assert.ok(urls.includes("https://hexdb.io/api/v1/route/icao/UAL456"));
    assert.ok(!urls.some((url) => url.startsWith("/api/hexdb")));
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("caches provider 404 misses", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestCount += 1;

    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({ response: "unknown callsign" }, { status: 404 });
    }

    if (url.includes("opensky-network.org")) {
      return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
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
    const first = await firstRoute("UAL457");
    const second = await firstRoute("UAL457");

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("does not cache transient provider failures", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async () => {
    requestCount += 1;
    throw new TypeError("temporary network failure");
  }) as typeof fetch;

  try {
    const first = await firstRoute("UAL458");
    const second = await firstRoute("UAL458");

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(requestCount, 6);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("route providers treat empty 201, HTML, and invalid JSON as temporary", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.adsbdb.com")) {
      return new Response("", {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("hexdb.io")) {
      return new Response("<html>wait</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const resolution = await resolveReportedRoutes("UAL459");
    assert.deepEqual(resolution.routes, []);
    assert.equal(resolution.temporarilyUnavailable, true);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("route provider timeouts remain temporary", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new DOMException("Timed out", "TimeoutError");
  }) as typeof fetch;

  try {
    const resolution = await resolveReportedRoutes("UAL460");
    assert.deepEqual(resolution.routes, []);
    assert.equal(resolution.temporarilyUnavailable, true);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("uses OpenSky when it is the only provider with a route", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({ response: "unknown callsign" }, { status: 404 });
    }

    if (url.includes("opensky-network.org")) {
      return jsonResponse({
        callsign: "BAW123",
        route: ["EGLL", "KSFO"],
        updateTime: 1234567890,
      });
    }

    if (url.includes("hexdb.io")) {
      return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
    }

    return jsonResponse({ status: "404", error: "not found" }, { status: 404 });
  }) as typeof fetch;

  try {
    const route = await firstRoute("BAW123");

    assert.equal(route?.source, "opensky");
    assert.equal(route?.origin?.icao, "EGLL");
    assert.equal(route?.destination?.icao, "KSFO");
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

test("returns every provider's route in priority order", async () => {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.adsbdb.com")) {
      return jsonResponse({
        response: {
          flightroute: {
            origin: { iata_code: "FRA", icao_code: "EDDF", latitude: 50.03, longitude: 8.57 },
            destination: { iata_code: "ICN", icao_code: "RKSI", latitude: 37.46, longitude: 126.44 },
          },
        },
      });
    }
    if (url.includes("opensky-network.org")) {
      return jsonResponse({ callsign: "DLH712", route: ["EGLL", "KSFO"] });
    }
    return jsonResponse({ status: "404" }, { status: 404 });
  }) as typeof fetch;

  try {
    const { routes } = await resolveReportedRoutes("dlh712");
    assert.deepEqual(
      routes.map((route) => [route.source, route.origin.icao, route.destination.icao]),
      [
        ["adsbdb", "EDDF", "RKSI"],
        ["opensky", "EGLL", "KSFO"],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
});

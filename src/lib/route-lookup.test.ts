import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRouteCache,
  lookupReportedRoutes,
  type ReportedRoute,
} from "./route-lookup";

const route: ReportedRoute = {
  callsign: "UAL123",
  origin: {
    iata: "SFO",
    icao: "KSFO",
    name: "San Francisco International Airport",
    municipality: "San Francisco",
    countryIso: "US",
    latitude: 37.619,
    longitude: -122.375,
  },
  destination: {
    iata: "LHR",
    icao: "EGLL",
    name: "London Heathrow Airport",
    municipality: "London",
    countryIso: "GB",
    latitude: 51.4706,
    longitude: -0.4619,
  },
  source: "adsbdb",
  fetchedAt: 1_779_840_000_000,
};

async function withFetch(
  respond: (url: string) => Response | Promise<Response>,
  run: (urls: string[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return respond(String(input));
  }) as typeof fetch;
  clearRouteCache();
  try {
    await run(urls);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteCache();
  }
}

test("requests routes by callsign alone and caches them", async () => {
  await withFetch(
    () => Response.json({ ...route, routes: [route] }),
    async (urls) => {
      assert.deepEqual(await lookupReportedRoutes(" ual123 "), [route]);
      assert.deepEqual(await lookupReportedRoutes("UAL123"), [route]);
      assert.deepEqual(urls, ["/api/routes?callsign=UAL123"]);
    },
  );
});

test("drops malformed routes and routes for another callsign", async () => {
  await withFetch(
    () =>
      Response.json({
        routes: [
          route,
          { ...route, callsign: "DAL1" },
          { ...route, origin: { iata: "SFO" } },
          { ...route, source: "unknown" },
        ],
      }),
    async () => {
      assert.deepEqual(await lookupReportedRoutes("UAL123"), [route]);
    },
  );
});

test("caches a 404 as a miss", async () => {
  await withFetch(
    () => Response.json({ error: "Route unavailable" }, { status: 404 }),
    async (urls) => {
      assert.deepEqual(await lookupReportedRoutes("UAL404"), []);
      assert.deepEqual(await lookupReportedRoutes("UAL404"), []);
      assert.equal(urls.length, 1);
    },
  );
});

test("retries after a temporary failure", async () => {
  let attempts = 0;
  await withFetch(
    () =>
      attempts++ === 0
        ? Response.json({ error: "temporarily unavailable" }, { status: 503 })
        : Response.json({ ...route, routes: [route] }),
    async (urls) => {
      assert.deepEqual(await lookupReportedRoutes("UAL123"), []);
      assert.deepEqual(await lookupReportedRoutes("UAL123"), [route]);
      assert.equal(urls.length, 2);
    },
  );
});

test("skips invalid callsigns without a request", async () => {
  await withFetch(
    () => {
      throw new Error("Unexpected request");
    },
    async (urls) => {
      assert.deepEqual(await lookupReportedRoutes("../../EGLL"), []);
      assert.deepEqual(urls, []);
    },
  );
});

test("concurrent lookups share one request that no caller can cancel", async () => {
  let resolveResponse: (response: Response) => void = () => {};
  await withFetch(
    () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
    async (urls) => {
      const first = lookupReportedRoutes("UAL123");
      const second = lookupReportedRoutes("UAL123");
      resolveResponse(Response.json({ ...route, routes: [route] }));
      assert.deepEqual(await first, [route]);
      assert.deepEqual(await second, [route]);
      assert.equal(urls.length, 1);
    },
  );
});

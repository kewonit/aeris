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
    // adsbdb, hexdb and OpenSky, and both files the standing data could
    // keep UAL's routes in.
    assert.equal(requestCount, 5);
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
    assert.equal(requestCount, 8);
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

const STANDING_DATA = "https://raw.githubusercontent.com/vradarserver/standing-data/main";

function csvResponse(text: string) {
  return new Response(`\uFEFF${text}`, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

async function withProviders(
  respond: (url: string) => Response | undefined,
  run: (urls: string[]) => Promise<void>,
): Promise<void> {
  clearRouteResolverCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return respond(url) ?? jsonResponse({ status: "404" }, { status: 404 });
  }) as typeof fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = originalFetch;
    clearRouteResolverCache();
  }
}

const legsOf = (routes: { source: string; origin: { icao: string }; destination: { icao: string } }[]) =>
  routes.map((route) => [route.source, `${route.origin.icao}-${route.destination.icao}`]);

test("standing data comes first, with one route per leg of a flight with stops", async () => {
  await withProviders(
    (url) => {
      if (url === `${STANDING_DATA}/routes/schema-01/U/UAL-all.csv`) {
        return csvResponse(
          "Callsign,Code,Number,AirlineCode,AirportCodes\r\n" +
            "UAL246,UAL,246,UAL,KORD-KPHL\r\n" +
            "UAL247,UAL,247,UAL,KPHL-KORD-KOMA\r\n",
        );
      }
      if (url === "https://hexdb.io/api/v1/route/icao/UAL247") {
        return jsonResponse({ flight: "UAL247", route: "KPHL-KORD-KDEN" });
      }
      return undefined;
    },
    async () => {
      const { routes } = await resolveReportedRoutes("UAL247");
      // hexdb's PHL to ORD repeats the standing data's, so it is listed once.
      assert.deepEqual(legsOf(routes), [
        ["vrs", "KPHL-KORD"],
        ["vrs", "KORD-KOMA"],
        ["hexdb", "KORD-KDEN"],
      ]);
    },
  );
});

test("one standing data file answers every flight of its airline", async () => {
  await withProviders(
    (url) => {
      if (url === `${STANDING_DATA}/routes/schema-01/R/RYR-all.csv`) {
        return jsonResponse({ status: "404" }, { status: 404 });
      }
      // A large airline's routes are split by the flight number's first digit.
      if (url === `${STANDING_DATA}/routes/schema-01/R/RYR-2.csv`) {
        return csvResponse(
          "Callsign,Code,Number,AirlineCode,AirportCodes\n" +
            "RYR2LW,RYR,2LW,RYR,EGSS-LIPY\n" +
            "RYR20,RYR,20,RYR,EIDW-EGNT\n",
        );
      }
      return undefined;
    },
    async (urls) => {
      assert.deepEqual(legsOf((await resolveReportedRoutes("RYR2LW")).routes), [
        ["vrs", "EGSS-LIPY"],
      ]);
      assert.deepEqual(legsOf((await resolveReportedRoutes("RYR20")).routes), [
        ["vrs", "EIDW-EGNT"],
      ]);
      const routeFiles = urls.filter((url) => url.includes("/routes/schema-01/"));
      assert.deepEqual(routeFiles, [
        `${STANDING_DATA}/routes/schema-01/R/RYR-all.csv`,
        `${STANDING_DATA}/routes/schema-01/R/RYR-2.csv`,
      ]);
    },
  );
});

test("airports carry the city a traveller would name, whichever provider reported them", async () => {
  await withProviders(
    (url) => {
      if (url === "https://hexdb.io/api/v1/route/icao/BAW875") {
        return jsonResponse({ flight: "BAW875", route: "LROP-EGLL" });
      }
      if (url === `${STANDING_DATA}/airports/schema-01/L/LR.csv`) {
        return csvResponse(
          "Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet\n" +
            "LROP,Henri Coandă International Airport,LROP,OTP,Bucharest,RO,44.571111,26.085,314\n",
        );
      }
      return undefined;
    },
    async (urls) => {
      const [route] = (await resolveReportedRoutes("BAW875")).routes;
      assert.equal(route.source, "hexdb");
      assert.equal(route.origin.iata, "OTP");
      assert.equal(route.origin.municipality, "Bucharest");
      // Without a standing data row, the app's own airport list names it.
      assert.equal(route.destination.municipality, "London");
      assert.ok(!urls.some((url) => url.includes("hexdb.io/api/v1/airport")));
    },
  );
});

test("an airport the app does not list comes from the standing data", async () => {
  await withProviders(
    (url) => {
      if (url.includes("opensky-network.org")) {
        return jsonResponse({ callsign: "EZY8013", route: ["EGKK", "XRHO"] });
      }
      if (url === `${STANDING_DATA}/airports/schema-01/X/XR.csv`) {
        return csvResponse(
          "Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet\n" +
            'XRHO,Diagoras Airport,XRHO,RHO,"Rodes, Island",GR,36.405399,28.086201,17\n',
        );
      }
      return undefined;
    },
    async () => {
      const [route] = (await resolveReportedRoutes("EZY8013")).routes;
      assert.equal(route.destination.name, "Diagoras Airport");
      assert.equal(route.destination.municipality, "Rodes, Island");
      assert.equal(route.destination.latitude, 36.405399);
    },
  );
});

test("keeps an adsbdb route between airports it names by IATA code alone", async () => {
  await withProviders(
    (url) =>
      url === "https://api.adsbdb.com/v0/callsign/XYZ12"
        ? jsonResponse({
            response: {
              flightroute: {
                origin: { iata_code: "AAA", latitude: -17.35, longitude: -145.51 },
                destination: { iata_code: "BBB", latitude: -16.5, longitude: -151.75 },
              },
            },
          })
        : undefined,
    async () => {
      const { routes } = await resolveReportedRoutes("XYZ12");
      assert.deepEqual(
        routes.map((route) => [route.origin.iata, route.destination.iata]),
        [["AAA", "BBB"]],
      );
    },
  );
});

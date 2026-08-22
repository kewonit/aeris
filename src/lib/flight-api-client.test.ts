import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFlightByHex,
  fetchFlightsByCallsign,
  fetchFlightsByHex,
  fetchFlightsByPoint,
  getCircuitState,
  resetAllCircuits,
} from "./flight-api-client";

function rawAircraft(hex = "abc123") {
  return {
    hex,
    type: "adsb_icao",
    flight: "TST123 ",
    lat: 12.5,
    lon: 77.6,
    alt_baro: 30_000,
    seen_pos: 0.2,
  };
}

function readsbResponse(ac: unknown[], status = 200): Response {
  return Response.json(
    { ac, msg: "No error", now: Date.now(), total: ac.length },
    { status },
  );
}

function openskyResponse(hex = "abc123"): Response {
  return Response.json({
    time: 1,
    states: [
      [
        hex,
        "TST123 ",
        "Unknown",
        1,
        1,
        77.6,
        12.5,
        9_144,
        false,
        220,
        90,
        0,
        null,
        9_200,
        "1200",
        false,
        0,
        3,
      ],
    ],
  });
}

function restoreWindow(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, "window", descriptor);
  } else {
    delete (globalThis as typeof globalThis & { window?: unknown }).window;
  }
}

test("adsb.lol success short-circuits point fallback", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return readsbResponse([rawAircraft()]);
  };

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.equal(result.source, "adsb");
    assert.equal(result.flights.length, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /provider=adsb/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a valid empty point response does not trigger fallback", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return readsbResponse([]);
  };

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.deepEqual(result.flights, []);
    assert.equal(result.source, "adsb");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty hex lookup continues from adsb.lol to airplanes.live", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return url.includes("provider=adsb")
      ? readsbResponse([])
      : readsbResponse([rawAircraft()]);
  };

  try {
    const result = await fetchFlightsByHex("abc123");
    assert.equal(result.source, "airplanes");
    assert.equal(result.flights.length, 1);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /provider=adsb/);
    assert.match(calls[1], /provider=airplanes/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenSky takes over a hex lookup after both readsb providers fail", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return url.startsWith("/api/flights")
      ? new Response(null, { status: 502 })
      : openskyResponse();
  };

  try {
    const result = await fetchFlightsByHex("abc123");
    assert.equal(result.source, "opensky");
    assert.equal(result.flights[0]?.icao24, "abc123");
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenSky takes over a callsign lookup after both readsb providers fail", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return url.startsWith("/api/flights")
      ? new Response(null, { status: 502 })
      : openskyResponse();
  };

  try {
    const result = await fetchFlightsByCallsign("TST123");
    assert.equal(result.source, "opensky");
    assert.equal(result.flights[0]?.callsign, "TST123");
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit airplanes.live override stays pinned", async () => {
  resetAllCircuits();
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const calls: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?provider=airplanes" },
      addEventListener: () => {},
    },
  });
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return readsbResponse([rawAircraft()]);
  };

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.equal(result.source, "airplanes");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /provider=airplanes/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow(originalWindow);
  }
});

test("401 and 403 open a provider circuit immediately for five minutes", async () => {
  for (const status of [401, 403]) {
    resetAllCircuits();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) =>
      input.toString().includes("provider=adsb")
        ? new Response(null, { status })
        : readsbResponse([rawAircraft()]);

    try {
      await fetchFlightsByPoint(12.5, 77.6, 1);
      const circuit = getCircuitState("adsb");
      assert.equal(circuit.state, "open");
      assert.ok(circuit.cooldownRemaining > 299_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("429 remains rate limiting and does not open the circuit", async () => {
  resetAllCircuits();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) =>
    input.toString().includes("provider=adsb")
      ? new Response(null, { status: 429 })
      : readsbResponse([rawAircraft()]);

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.equal(result.source, "airplanes");
    assert.equal(getCircuitState("adsb").state, "closed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one-off lookup success does not change point-polling stickiness", async () => {
  resetAllCircuits();
  let phase: "lookup" | "point" = "lookup";
  const pointCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (phase === "lookup") {
      return url.includes("provider=adsb")
        ? readsbResponse([])
        : readsbResponse([rawAircraft()]);
    }
    pointCalls.push(url);
    return readsbResponse([rawAircraft()]);
  };

  try {
    assert.ok((await fetchFlightByHex("abc123")).flight);
    phase = "point";
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.equal(result.source, "adsb");
    assert.equal(pointCalls.length, 1);
    assert.match(pointCalls[0], /provider=adsb/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid callsigns are rejected before any provider request", async () => {
  resetAllCircuits();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return readsbResponse([]);
  };

  try {
    assert.deepEqual(await fetchFlightsByCallsign("TOO-LONG-123"), {
      flights: [],
      rateLimited: false,
    });
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

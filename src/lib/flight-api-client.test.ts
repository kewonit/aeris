import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFlightByHex,
  fetchFlightsByCallsign,
  fetchFlightsByHex,
  fetchFlightsByPoint,
  getCircuitState,
  PROVIDER_CHANGE_EVENT,
  resetAllCircuits,
  setProviderOverride,
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

function providerFromRequest(input: RequestInfo | URL | string): string | null {
  return new URL(input.toString(), "http://localhost").searchParams.get(
    "provider",
  );
}

test("provider selection updates the URL and emits an immediate refresh event", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events: string[] = [];
  const location = {
    href: "https://aeris.example/city/sfo?provider=adsb",
    search: "?provider=adsb",
  };
  const fakeWindow = {
    location,
    history: {
      replaceState: (_state: unknown, _unused: string, href: string) => {
        location.href = href;
        location.search = new URL(href).search;
      },
    },
    addEventListener: () => {},
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  try {
    setProviderOverride("adsbfi");
    assert.equal(location.search, "?provider=adsbfi");
    assert.deepEqual(events, [PROVIDER_CHANGE_EVENT]);

    setProviderOverride("auto");
    assert.equal(location.search, "");
    assert.deepEqual(events, [PROVIDER_CHANGE_EVENT, PROVIDER_CHANGE_EVENT]);
  } finally {
    restoreWindow(originalWindow);
  }
});

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
    assert.equal(providerFromRequest(calls[0]), "adsb");
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

test("an adsb.lol point failure falls back to adsb.fi", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    const provider = providerFromRequest(url);
    return provider === "adsb"
      ? new Response(null, { status: 502 })
      : readsbResponse([rawAircraft()]);
  };

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.equal(result.source, "adsbfi");
    assert.equal(result.flights.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(providerFromRequest(calls[0]), "adsb");
    assert.equal(providerFromRequest(calls[1]), "adsbfi");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty hex lookup continues from adsb.lol to adsb.fi", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return providerFromRequest(url) === "adsb"
      ? readsbResponse([])
      : readsbResponse([rawAircraft()]);
  };

  try {
    const result = await fetchFlightsByHex("abc123");
    assert.equal(result.source, "adsbfi");
    assert.equal(result.flights.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(providerFromRequest(calls[0]), "adsb");
    assert.equal(providerFromRequest(calls[1]), "adsbfi");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an adsb.fi lookup miss continues to airplanes.live", async () => {
  resetAllCircuits();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return url.includes("provider=airplanes")
      ? readsbResponse([rawAircraft()])
      : readsbResponse([]);
  };

  try {
    const result = await fetchFlightsByHex("abc123");
    assert.equal(result.source, "airplanes");
    assert.equal(result.flights.length, 1);
    assert.equal(calls.length, 3);
    assert.equal(providerFromRequest(calls[0]), "adsb");
    assert.equal(providerFromRequest(calls[1]), "adsbfi");
    assert.equal(providerFromRequest(calls[2]), "airplanes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenSky takes over a hex lookup after all readsb providers fail", async () => {
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
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenSky takes over a callsign lookup after all readsb providers fail", async () => {
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
    assert.equal(calls.length, 4);
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
    assert.equal(providerFromRequest(calls[0]), "airplanes");
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow(originalWindow);
  }
});

test("explicit adsb.fi override stays pinned", async () => {
  resetAllCircuits();
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const calls: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?provider=adsbfi" },
      addEventListener: () => {},
    },
  });
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return readsbResponse([rawAircraft()]);
  };

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.equal(result.source, "adsbfi");
    assert.equal(calls.length, 1);
    assert.equal(providerFromRequest(calls[0]), "adsbfi");
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
      providerFromRequest(input) === "adsb"
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
    providerFromRequest(input) === "adsb"
      ? new Response(null, { status: 429 })
      : readsbResponse([rawAircraft()]);

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 1);
    assert.equal(result.source, "adsbfi");
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
      return providerFromRequest(url) === "adsb"
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
    assert.equal(providerFromRequest(pointCalls[0]), "adsb");
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

test("a point request that times out on adsb.lol is answered by adsb.fi", async () => {
  resetAllCircuits();
  const providers: (string | null)[] = [];
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  // Fire every timeout at once, so the 8 s provider timeout trips now.
  globalThis.setTimeout = ((handler: () => void) =>
    originalSetTimeout(handler, 0)) as typeof setTimeout;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const provider = providerFromRequest(input.toString());
    providers.push(provider);
    if (provider !== "adsb") return readsbResponse([rawAircraft()]);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  }) as typeof fetch;

  try {
    const result = await fetchFlightsByPoint(12.5, 77.6, 2);
    assert.equal(result.source, "adsbfi");
    assert.equal(result.flights.length, 1);
    assert.deepEqual(providers, ["adsb", "adsbfi"]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("the caller's own abort still cancels a point request", async () => {
  resetAllCircuits();
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
      controller.abort();
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchFlightsByPoint(12.5, 77.6, 2, controller.signal),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/** A request that never answers, failing only once its signal aborts. */
function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });
}

/** Runs `run` with every timer firing at once, so provider timeouts trip now. */
async function withImmediateTimers<T>(run: () => Promise<T>): Promise<T> {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: () => void) =>
    originalSetTimeout(handler, 0)) as typeof setTimeout;
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("three timeouts in a row open a provider's circuit, so it is skipped", async () => {
  resetAllCircuits();
  const providers: (string | null)[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const provider = providerFromRequest(input.toString());
    providers.push(provider);
    return provider === "adsb"
      ? hangUntilAborted(init)
      : readsbResponse([rawAircraft()]);
  }) as typeof fetch;

  try {
    await withImmediateTimers(async () => {
      for (let i = 0; i < 3; i++) await fetchFlightsByHex("abc123");
    });
    const circuit = getCircuitState("adsb");
    assert.equal(circuit.state, "open");
    assert.ok(circuit.cooldownRemaining > 59_000);

    providers.length = 0;
    await withImmediateTimers(() => fetchFlightsByHex("abc123"));
    assert.deepEqual(providers, ["adsbfi"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a timeout before rate limits still reports the poll as rate limited", async () => {
  resetAllCircuits();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    providerFromRequest(input.toString()) === "adsb"
      ? hangUntilAborted(init)
      : new Response(null, { status: 429 })) as typeof fetch;

  try {
    const result = await withImmediateTimers(() =>
      fetchFlightsByPoint(12.5, 77.6, 2),
    );
    assert.equal(result.rateLimited, true);
    assert.deepEqual(result.flights, []);
    // Rate limits never trip a circuit.
    for (const tier of ["adsbfi", "airplanes", "opensky"]) {
      assert.equal(getCircuitState(tier).state, "closed", tier);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

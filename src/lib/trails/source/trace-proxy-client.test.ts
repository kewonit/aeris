import assert from "node:assert/strict";
import test from "node:test";

import { fetchTraceViaProxy } from "./trace-proxy-client";

test("fetchTraceViaProxy falls back safely for non-JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<html>upstream error</html>", {
      status: 502,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    })) as typeof fetch;

  try {
    const result = await fetchTraceViaProxy("ABC123");

    assert.deepEqual(result, {
      hex: "abc123",
      track: null,
      source: null,
      outcome: "provider-unavailable",
      creditsRemaining: null,
      retryAfterSeconds: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchTraceViaProxy preserves valid JSON payloads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        hex: "abc123",
        track: null,
        source: "opensky",
        outcome: "rate-limited",
        creditsRemaining: 12,
        retryAfterSeconds: 45,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    )) as typeof fetch;

  try {
    const result = await fetchTraceViaProxy("ABC123");

    assert.deepEqual(result, {
      hex: "abc123",
      track: null,
      source: "opensky",
      outcome: "rate-limited",
      creditsRemaining: 12,
      retryAfterSeconds: 45,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchTraceViaProxy normalizes mixed-case hex values from proxy responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        hex: "AbC123",
        track: null,
        source: "opensky",
        outcome: "provider-unavailable",
        creditsRemaining: null,
        retryAfterSeconds: null,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    )) as typeof fetch;

  try {
    const result = await fetchTraceViaProxy("ABC123");

    assert.equal(result.hex, "abc123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

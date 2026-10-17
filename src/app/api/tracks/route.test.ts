import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET } from "./[trackId]/route";

function request(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/tracks/track-a${query}`);
}

test("selected-track route forwards only a validated bounded relay query", async () => {
  const originalFetch = globalThis.fetch;
  const previousOrigin = process.env.FLIGHT_DATA_ORIGIN;
  const previousToken = process.env.FLIGHT_RELAY_HTTP_TOKEN;
  process.env.FLIGHT_DATA_ORIGIN = "https://relay.example.test";
  process.env.FLIGHT_RELAY_HTTP_TOKEN = "synthetic-token";
  let forwardedUrl = "";
  let forwardedAuthorization = "";
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    forwardedUrl = input.toString();
    forwardedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({
      track: null,
      meta: {
        sourceStatus: "live",
        attribution: { provider: "synthetic" },
        retention: {
          retentionStart: "2026-08-30T00:00:00.000Z",
          retentionEnd: "2026-08-30T01:00:00.000Z",
          retentionComplete: true,
        },
      },
    });
  };

  try {
    const response = await GET(request("?window=600&limit=120"), {
      params: Promise.resolve({ trackId: "track-a" }),
    });
    assert.equal(response.status, 200);
    assert.equal(
      forwardedUrl,
      "https://relay.example.test/v1/tracks/track-a?window=600&limit=120",
    );
    assert.equal(forwardedAuthorization, "Bearer synthetic-token");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOrigin === undefined) delete process.env.FLIGHT_DATA_ORIGIN;
    else process.env.FLIGHT_DATA_ORIGIN = previousOrigin;
    if (previousToken === undefined) delete process.env.FLIGHT_RELAY_HTTP_TOKEN;
    else process.env.FLIGHT_RELAY_HTTP_TOKEN = previousToken;
  }
});

test("selected-track route rejects unsafe identifiers and limits before relay access", async () => {
  const previousOrigin = process.env.FLIGHT_DATA_ORIGIN;
  const previousToken = process.env.FLIGHT_RELAY_HTTP_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.FLIGHT_DATA_ORIGIN = "https://relay.example.test";
  process.env.FLIGHT_RELAY_HTTP_TOKEN = "synthetic-token";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };

  try {
    assert.equal(
      (
        await GET(request(), {
          params: Promise.resolve({ trackId: "../status" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await GET(request("?window=3601"), {
          params: Promise.resolve({ trackId: "track-a" }),
        })
      ).status,
      400,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOrigin === undefined) delete process.env.FLIGHT_DATA_ORIGIN;
    else process.env.FLIGHT_DATA_ORIGIN = previousOrigin;
    if (previousToken === undefined) delete process.env.FLIGHT_RELAY_HTTP_TOKEN;
    else process.env.FLIGHT_RELAY_HTTP_TOKEN = previousToken;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getTrack } from "../tracks/[trackId]/route";
import { GET as getTrails } from "./route";

test("history routes validate bounds and keep relay credentials server-side", async () => {
  const previousOrigin = process.env.FLIGHT_DATA_ORIGIN;
  const previousToken = process.env.FLIGHT_RELAY_HTTP_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.FLIGHT_DATA_ORIGIN = "https://relay.example.test";
  process.env.FLIGHT_RELAY_HTTP_TOKEN = "synthetic-token";
  const calls: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), headers: new Headers(init?.headers) });
    return Response.json({ tracks: [], meta: { sourceStatus: "live" } });
  };

  try {
    const trails = await getTrails(
      new NextRequest(
        "https://app.example.test/api/trails?bbox=10,10,12,12&window=600&limitPerAircraft=120",
      ),
    );
    assert.equal(trails.status, 200);
    assert.equal(
      calls[0].url,
      "https://relay.example.test/v1/trails?bbox=10%2C10%2C12%2C12&window=600&limitPerAircraft=120",
    );
    assert.equal(calls[0].headers.get("authorization"), "Bearer synthetic-token");

    const track = await getTrack(
      new NextRequest(
        "https://app.example.test/api/tracks/track-a?window=3600&limit=720",
      ),
      { params: Promise.resolve({ trackId: "track-a" }) },
    );
    assert.equal(track.status, 200);
    assert.equal(
      calls[1].url,
      "https://relay.example.test/v1/tracks/track-a?window=3600&limit=720",
    );

    const invalid = await getTrails(
      new NextRequest(
        "https://app.example.test/api/trails?bbox=-180,-90,180,90",
      ),
    );
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOrigin === undefined) delete process.env.FLIGHT_DATA_ORIGIN;
    else process.env.FLIGHT_DATA_ORIGIN = previousOrigin;
    if (previousToken === undefined) delete process.env.FLIGHT_RELAY_HTTP_TOKEN;
    else process.env.FLIGHT_RELAY_HTTP_TOKEN = previousToken;
  }
});

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";

import { clearTicketRateLimitsForTests } from "@/lib/relay/ticket";

import { POST } from "./route";

test("ticket route signs only exact same-origin requests and never returns a URL token", async () => {
  const previous = {
    key: process.env.FLIGHT_STREAM_PRIVATE_KEY,
    stream: process.env.NEXT_PUBLIC_FLIGHT_STREAM_URL,
    origin: process.env.FLIGHT_APP_ORIGIN,
  };
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env.FLIGHT_STREAM_PRIVATE_KEY = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64url");
  process.env.NEXT_PUBLIC_FLIGHT_STREAM_URL =
    "wss://relay.example.test/v1/live";
  process.env.FLIGHT_APP_ORIGIN = "https://app.example.test";
  clearTicketRateLimitsForTests();

  try {
    const response = await POST(
      new NextRequest(
        "https://app.example.test/api/flights/stream-ticket",
        {
          method: "POST",
          headers: {
            origin: "https://app.example.test",
            "sec-fetch-site": "same-origin",
            "x-forwarded-for": "192.0.2.20",
          },
        },
      ),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = await response.json();
    assert.match(payload.ticket, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal("streamUrl" in payload, false);

    const crossOrigin = await POST(
      new NextRequest(
        "https://app.example.test/api/flights/stream-ticket",
        {
          method: "POST",
          headers: {
            origin: "https://other.example.test",
            "sec-fetch-site": "cross-site",
          },
        },
      ),
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    clearTicketRateLimitsForTests();
    if (previous.key === undefined) delete process.env.FLIGHT_STREAM_PRIVATE_KEY;
    else process.env.FLIGHT_STREAM_PRIVATE_KEY = previous.key;
    if (previous.stream === undefined)
      delete process.env.NEXT_PUBLIC_FLIGHT_STREAM_URL;
    else process.env.NEXT_PUBLIC_FLIGHT_STREAM_URL = previous.stream;
    if (previous.origin === undefined) delete process.env.FLIGHT_APP_ORIGIN;
    else process.env.FLIGHT_APP_ORIGIN = previous.origin;
  }
});

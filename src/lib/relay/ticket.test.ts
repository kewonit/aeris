import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";

import {
  clearTicketRateLimitsForTests,
  consumeTicketIssueLimit,
  createStreamTicket,
  validateTicketRequestOrigin,
} from "./ticket";

test("stream tickets bind a short expiry, unique id, and exact origin", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { ticket, expiresAt } = createStreamTicket(
    { privateKey, streamUrl: "wss://relay.example.test/v1/live", attribution: null },
    "https://app.example.test",
    { now: 1_000_000, id: "synthetic-id" },
  );
  const [encodedPayload, encodedSignature] = ticket.split(".");
  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());

  assert.deepEqual(claims, {
    jti: "synthetic-id",
    exp: expiresAt,
    origin: "https://app.example.test",
  });
  assert.equal(expiresAt, 1_060);
  assert.equal(
    verify(
      null,
      Buffer.from(encodedPayload),
      publicKey,
      Buffer.from(encodedSignature, "base64url"),
    ),
    true,
  );
});

test("ticket requests require the exact same origin and fetch-site", () => {
  const allowed = new NextRequest("https://app.example.test/api/flights/stream-ticket", {
    method: "POST",
    headers: {
      origin: "https://app.example.test",
      "sec-fetch-site": "same-origin",
    },
  });
  const rejected = new NextRequest("https://app.example.test/api/flights/stream-ticket", {
    method: "POST",
    headers: {
      origin: "https://other.example.test",
      "sec-fetch-site": "cross-site",
    },
  });
  assert.equal(validateTicketRequestOrigin(allowed), "https://app.example.test");
  assert.equal(validateTicketRequestOrigin(rejected), null);
});

test("ticket issuance is bounded per anonymized address", () => {
  const previous = process.env.FLIGHT_TICKET_ISSUE_LIMIT;
  process.env.FLIGHT_TICKET_ISSUE_LIMIT = "2";
  clearTicketRateLimitsForTests();
  const request = new NextRequest("https://app.example.test/api/flights/stream-ticket", {
    headers: { "x-forwarded-for": "192.0.2.10" },
  });
  try {
    assert.equal(consumeTicketIssueLimit(request, 1_000), true);
    assert.equal(consumeTicketIssueLimit(request, 1_001), true);
    assert.equal(consumeTicketIssueLimit(request, 1_002), false);
    assert.equal(consumeTicketIssueLimit(request, 61_001), true);
  } finally {
    clearTicketRateLimitsForTests();
    if (previous === undefined) delete process.env.FLIGHT_TICKET_ISSUE_LIMIT;
    else process.env.FLIGHT_TICKET_ISSUE_LIMIT = previous;
  }
});

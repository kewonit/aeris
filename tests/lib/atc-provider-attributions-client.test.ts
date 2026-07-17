import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAtcProviderAttributions,
  parseAtcProviderAttributions,
} from "@/lib/atc-provider-attributions-client";

test("provider attribution responses are narrowed to safe, unique links", () => {
  assert.deepEqual(
    parseAtcProviderAttributions({
      providers: [
        {
          id: "liveatc",
          label: "LiveATC",
          attributionUrl: "https://www.liveatc.net/",
        },
        {
          id: "community",
          label: "Community receiver",
          attributionUrl: "https://radio.example.com/about",
        },
        {
          id: "community",
          label: "Duplicate",
          attributionUrl: "https://duplicate.example.com/",
        },
        {
          id: "unsafe",
          label: "Unsafe",
          attributionUrl: "javascript:alert(1)",
        },
        null,
      ],
    }),
    [
      {
        id: "liveatc",
        label: "LiveATC",
        attributionUrl: "https://www.liveatc.net/",
      },
      {
        id: "community",
        label: "Community receiver",
        attributionUrl: "https://radio.example.com/about",
      },
    ],
  );
});

test("provider attribution fetch uses the manifest without an ICAO", async () => {
  let requestedUrl = "";
  const providers = await loadAtcProviderAttributions(
    undefined,
    (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          providers: [
            {
              id: "liveatc",
              label: "LiveATC",
              attributionUrl: "https://www.liveatc.net/",
            },
          ],
        }),
      );
    }) as typeof fetch,
  );

  assert.equal(requestedUrl, "/api/atc/sources");
  assert.equal(providers[0]?.label, "LiveATC");
});

test("provider attribution fetch failures stay quiet", async () => {
  const failedResponse = await loadAtcProviderAttributions(
    undefined,
    (async () => new Response(null, { status: 503 })) as typeof fetch,
  );
  const networkFailure = await loadAtcProviderAttributions(
    undefined,
    (async () => {
      throw new Error("offline");
    }) as typeof fetch,
  );

  assert.deepEqual(failedResponse, []);
  assert.deepEqual(networkFailure, []);
});

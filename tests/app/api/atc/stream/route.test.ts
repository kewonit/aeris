import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

async function withSourceConfig<T>(
  rawConfig: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.ATC_CUSTOM_SOURCES_JSON;
  if (rawConfig === undefined) {
    delete process.env.ATC_CUSTOM_SOURCES_JSON;
  } else {
    process.env.ATC_CUSTOM_SOURCES_JSON = rawConfig;
  }

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.ATC_CUSTOM_SOURCES_JSON;
    } else {
      process.env.ATC_CUSTOM_SOURCES_JSON = previous;
    }
  }
}

test("GET relays an allowlisted built-in source as same-origin audio", async () => {
  await withSourceConfig(undefined, async () => {
    const originalFetch = globalThis.fetch;
    const upstreamRequests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      upstreamRequests.push({ url: String(input), init });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }) as typeof fetch;

    try {
      const routeModule = await import("@/app/api/atc/stream/route");
      const response = await routeModule.GET(
        new NextRequest(
          "https://aeris.edbn.me/api/atc/stream?source=liveatc%3Akjfk-tower&mode=proxy",
        ),
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        [...new Uint8Array(await response.arrayBuffer())],
        [1, 2, 3],
      );
      assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
      assert.equal(
        response.headers.get("Cache-Control"),
        "no-cache, no-store, must-revalidate",
      );
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(response.headers.get("X-ATC-Provider"), "liveatc");
      const upstreamRequest = upstreamRequests[0];
      assert.ok(upstreamRequest);
      assert.equal(upstreamRequest.url, "https://d.liveatc.net/kjfk_twr");
      assert.equal(
        new Headers(upstreamRequest?.init?.headers).get("Referer"),
        "https://www.liveatc.net/",
      );
      assert.equal(upstreamRequest?.init?.redirect, "follow");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GET redirects an allowlisted custom source without exposing a relay mode", async () => {
  const rawConfig = JSON.stringify({
    providers: [
      {
        id: "community",
        label: "Community Receiver",
        attributionUrl: "https://radio.example.org/about",
      },
    ],
    sources: [
      {
        id: "receiver:one",
        providerId: "community",
        feedIds: ["kjfk-tower"],
        streamUrl: "https://radio.example.org:8443/live?channel=tower",
        priority: 10,
        cors: true,
      },
    ],
  });

  await withSourceConfig(rawConfig, async () => {
    const routeModule = await import("@/app/api/atc/stream/route");
    const response = await routeModule.GET(
      new NextRequest(
        "https://aeris.edbn.me/api/atc/stream?source=receiver%3Aone",
      ),
    );

    assert.equal(response.status, 307);
    assert.equal(response.body, null);
    assert.equal(
      response.headers.get("Location"),
      "https://radio.example.org:8443/live?channel=tower",
    );
    assert.equal(response.headers.get("X-ATC-Provider"), "community");
  });
});

test("GET converts a built-in upstream failure into a non-cacheable gateway error", async () => {
  await withSourceConfig(undefined, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("missing", { status: 404 })) as typeof fetch;

    try {
      const routeModule = await import("@/app/api/atc/stream/route");
      const response = await routeModule.GET(
        new NextRequest(
          "https://aeris.edbn.me/api/atc/stream?source=liveatc%3Akjfk-tower",
        ),
      );
      const body = (await response.json()) as { error?: string };

      assert.equal(response.status, 502);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(body.error, "Upstream stream unavailable.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GET rejects missing and unknown source IDs without touching a network", async () => {
  await withSourceConfig(undefined, async () => {
    const routeModule = await import("@/app/api/atc/stream/route");

    const missing = await routeModule.GET(
      new NextRequest("https://aeris.edbn.me/api/atc/stream?mount=kjfk_twr"),
    );
    const missingBody = (await missing.json()) as { error?: string };
    assert.equal(missing.status, 400);
    assert.equal(missing.headers.get("Cache-Control"), "no-store");
    assert.equal(missingBody.error, "Missing required 'source' parameter.");

    const unknown = await routeModule.GET(
      new NextRequest(
        "https://aeris.edbn.me/api/atc/stream?source=not-allowlisted",
      ),
    );
    const unknownBody = (await unknown.json()) as { error?: string };
    assert.equal(unknown.status, 403);
    assert.equal(unknown.headers.get("Cache-Control"), "no-store");
    assert.equal(unknownBody.error, "Unknown ATC source.");
  });
});

test("GET fails closed when deployment source configuration is malformed", async () => {
  await withSourceConfig("{invalid", async () => {
    const routeModule = await import("@/app/api/atc/stream/route");

    await assert.rejects(
      () =>
        routeModule.GET(
          new NextRequest(
            "https://aeris.edbn.me/api/atc/stream?source=liveatc%3Akjfk-tower",
          ),
        ),
      /Invalid ATC_CUSTOM_SOURCES_JSON: value must be valid JSON/,
    );
  });
});

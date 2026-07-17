import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

const MANIFEST_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

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

function customConfig(): string {
  return JSON.stringify({
    providers: [
      {
        id: "community-jfk",
        label: "JFK Community Receiver",
        attributionUrl: "https://radio.example.org/about",
      },
    ],
    sources: [
      {
        id: "community-jfk-tower",
        providerId: "community-jfk",
        feedIds: ["kjfk-tower"],
        streamUrl: "https://radio.example.org/kjfk-tower.mp3",
        priority: 50,
        cors: false,
      },
    ],
  });
}

test("GET without an ICAO returns provider attribution only", async () => {
  await withSourceConfig(customConfig(), async () => {
    const routeModule = await import("@/app/api/atc/sources/route");
    const response = await routeModule.GET(
      new NextRequest("https://aeris.edbn.me/api/atc/sources"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), MANIFEST_CACHE_CONTROL);
    assert.deepEqual(body.providers, [
      {
        id: "liveatc",
        label: "LiveATC.net",
        attributionUrl: "https://www.liveatc.net/",
      },
      {
        id: "community-jfk",
        label: "JFK Community Receiver",
        attributionUrl: "https://radio.example.org/about",
      },
    ]);
    assert.equal("sourcesByFeed" in body, false);
  });
});

test("GET returns a client-safe, priority-ordered manifest for one airport", async () => {
  await withSourceConfig(customConfig(), async () => {
    const routeModule = await import("@/app/api/atc/sources/route");
    const response = await routeModule.GET(
      new NextRequest("https://aeris.edbn.me/api/atc/sources?icao=kjfk"),
    );
    const body = (await response.json()) as {
      icao: string;
      sourcesByFeed: Record<string, Array<Record<string, unknown>>>;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), MANIFEST_CACHE_CONTROL);
    assert.equal(body.icao, "KJFK");
    assert.deepEqual(
      body.sourcesByFeed["kjfk-tower"].map((source) => source.id),
      ["community-jfk-tower", "liveatc:kjfk-tower"],
    );
    assert.deepEqual(body.sourcesByFeed["kjfk-tower"][0], {
      id: "community-jfk-tower",
      feedId: "kjfk-tower",
      providerId: "community-jfk",
      providerLabel: "JFK Community Receiver",
      attributionUrl: "https://radio.example.org/about",
      priority: 50,
      analyzable: false,
      playbackUrl:
        "/api/atc/stream?source=community-jfk-tower",
    });
    assert.equal(
      Object.values(body.sourcesByFeed)
        .flat()
        .some((source) => "streamUrl" in source),
      false,
    );
  });
});

test("GET rejects malformed airport codes without caching the error", async () => {
  await withSourceConfig(undefined, async () => {
    const routeModule = await import("@/app/api/atc/sources/route");
    const response = await routeModule.GET(
      new NextRequest("https://aeris.edbn.me/api/atc/sources?icao=JFK"),
    );
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(body.error, "Invalid airport code.");
  });
});

test("GET returns an empty cached mapping for a valid unknown airport", async () => {
  await withSourceConfig(undefined, async () => {
    const routeModule = await import("@/app/api/atc/sources/route");
    const response = await routeModule.GET(
      new NextRequest("https://aeris.edbn.me/api/atc/sources?icao=ZZZZ"),
    );
    const body = (await response.json()) as {
      icao?: string;
      sourcesByFeed?: Record<string, unknown>;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), MANIFEST_CACHE_CONTROL);
    assert.equal(body.icao, "ZZZZ");
    assert.deepEqual(body.sourcesByFeed, {});
  });
});

test("GET fails closed when deployment source configuration is malformed", async () => {
  await withSourceConfig("{invalid", async () => {
    const routeModule = await import("@/app/api/atc/sources/route");

    await assert.rejects(
      () =>
        routeModule.GET(
          new NextRequest("https://aeris.edbn.me/api/atc/sources?icao=KJFK"),
        ),
      /Invalid ATC_CUSTOM_SOURCES_JSON: value must be valid JSON/,
    );
  });
});

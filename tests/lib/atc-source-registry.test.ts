import assert from "node:assert/strict";
import test from "node:test";

import {
  createAtcSourceRegistry,
  LIVEATC_PROVIDER,
  LIVEATC_SOURCE_PRIORITY,
} from "@/lib/atc-source-registry";

function config(overrides: {
  providers?: unknown;
  sources?: unknown;
} = {}): string {
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
        streamUrl: "https://radio.example.org:8443/kjfk-tower.mp3",
        priority: 50,
        cors: true,
      },
    ],
    ...overrides,
  });
}

test("the default registry maps every logical feed to a built-in LiveATC source", () => {
  for (const rawConfig of [undefined, "", "   "]) {
    const registry = createAtcSourceRegistry(rawConfig);
    const tower = registry.sourcesByFeed["kjfk-tower"];

    assert.deepEqual(registry.providers, [LIVEATC_PROVIDER]);
    assert.deepEqual(tower, [
      {
        id: "liveatc:kjfk-tower",
        feedId: "kjfk-tower",
        providerId: "liveatc",
        providerLabel: "LiveATC.net",
        attributionUrl: "https://www.liveatc.net/",
        priority: LIVEATC_SOURCE_PRIORITY,
        analyzable: true,
        playbackUrl:
          "/api/atc/stream?source=liveatc%3Akjfk-tower",
      },
    ]);
    assert.deepEqual(registry.sourcesById.get("liveatc:kjfk-tower"), {
      id: "liveatc:kjfk-tower",
      providerId: "liveatc",
      streamUrl: "https://d.liveatc.net/kjfk_twr",
      relay: true,
    });
    assert.deepEqual(registry.mediaOrigins, ["https://*.liveatc.net"]);
  }
});

test("custom sources map to every declared feed and sort by priority", () => {
  const registry = createAtcSourceRegistry(
    config({
      sources: [
        {
          id: "community-secondary",
          providerId: "community-jfk",
          feedIds: ["kjfk-tower", "kjfk-ground"],
          streamUrl: "https://radio.example.org/combined.mp3",
          priority: 150,
          cors: false,
        },
        {
          id: "community-primary",
          providerId: "community-jfk",
          feedIds: ["kjfk-tower"],
          streamUrl: "https://radio.example.org/tower.mp3",
          priority: 25,
          cors: true,
        },
      ],
    }),
  );

  assert.deepEqual(
    registry.sourcesByFeed["kjfk-tower"].map((source) => source.id),
    [
      "community-primary",
      "liveatc:kjfk-tower",
      "community-secondary",
    ],
  );
  assert.deepEqual(
    registry.sourcesByFeed["kjfk-ground"].map((source) => source.id),
    ["liveatc:kjfk-ground", "community-secondary"],
  );
  assert.equal(
    registry.sourcesByFeed["kjfk-ground"][1]?.feedId,
    "kjfk-ground",
  );
  assert.equal(
    registry.sourcesByFeed["kjfk-ground"][1]?.analyzable,
    false,
  );
  assert.equal(
    registry.sourcesById.get("community-secondary")?.relay,
    false,
  );
});

test("equal priorities preserve a deterministic built-in then configuration order", () => {
  const registry = createAtcSourceRegistry(
    config({
      sources: [
        {
          id: "configured-first",
          providerId: "community-jfk",
          feedIds: ["kjfk-tower"],
          streamUrl: "https://one.example.org/audio",
          priority: 100,
          cors: true,
        },
        {
          id: "configured-second",
          providerId: "community-jfk",
          feedIds: ["kjfk-tower"],
          streamUrl: "https://two.example.org/audio",
          priority: 100,
          cors: true,
        },
      ],
    }),
  );

  assert.deepEqual(
    registry.sourcesByFeed["kjfk-tower"].map((source) => source.id),
    ["liveatc:kjfk-tower", "configured-first", "configured-second"],
  );
});

test("provider attribution and browser media origins are normalized and deduplicated", () => {
  const registry = createAtcSourceRegistry(
    config({
      sources: [
        {
          id: "one",
          providerId: "community-jfk",
          feedIds: ["kjfk-tower"],
          streamUrl: "https://RADIO.example.org:443/one",
          priority: 10,
          cors: true,
        },
        {
          id: "two",
          providerId: "community-jfk",
          feedIds: ["kjfk-ground"],
          streamUrl: "https://radio.example.org/two",
          priority: 20,
          cors: true,
        },
      ],
    }),
  );

  assert.deepEqual(registry.providers, [
    LIVEATC_PROVIDER,
    {
      id: "community-jfk",
      label: "JFK Community Receiver",
      attributionUrl: "https://radio.example.org/about",
    },
  ]);
  assert.deepEqual(registry.mediaOrigins, [
    "https://*.liveatc.net",
    "https://radio.example.org",
  ]);
});

test("malformed or incomplete registry values fail with deployment context", () => {
  assert.throws(
    () => createAtcSourceRegistry("{invalid"),
    /Invalid ATC_CUSTOM_SOURCES_JSON: value must be valid JSON/,
  );
  assert.throws(
    () => createAtcSourceRegistry("null"),
    /Invalid ATC_CUSTOM_SOURCES_JSON: value must be an object/,
  );
  assert.throws(
    () => createAtcSourceRegistry("{}"),
    /Invalid ATC_CUSTOM_SOURCES_JSON: providers must be an array/,
  );
});

test("provider and source IDs must be unique, including reserved built-ins", () => {
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          providers: [
            {
              id: "liveatc",
              label: "Impostor",
              attributionUrl: "https://example.org/",
            },
          ],
          sources: [],
        }),
      ),
    /duplicates provider ID 'liveatc'/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "liveatc:kjfk-tower",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower"],
              streamUrl: "https://radio.example.org/tower",
              priority: 10,
              cors: true,
            },
          ],
        }),
      ),
    /duplicates source ID 'liveatc:kjfk-tower'/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "duplicate",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower"],
              streamUrl: "https://radio.example.org/one",
              priority: 10,
              cors: true,
            },
            {
              id: "duplicate",
              providerId: "community-jfk",
              feedIds: ["kjfk-ground"],
              streamUrl: "https://radio.example.org/two",
              priority: 20,
              cors: false,
            },
          ],
        }),
      ),
    /duplicates source ID 'duplicate'/,
  );
});

test("sources must reference a known provider and unique known feeds", () => {
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "unknown-provider",
              providerId: "missing",
              feedIds: ["kjfk-tower"],
              streamUrl: "https://radio.example.org/tower",
              priority: 10,
              cors: true,
            },
          ],
        }),
      ),
    /references unknown provider 'missing'/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "unknown-feed",
              providerId: "community-jfk",
              feedIds: ["zzzz-tower"],
              streamUrl: "https://radio.example.org/tower",
              priority: 10,
              cors: true,
            },
          ],
        }),
      ),
    /references unknown feed 'zzzz-tower'/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "duplicate-feed",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower", "kjfk-tower"],
              streamUrl: "https://radio.example.org/tower",
              priority: 10,
              cors: true,
            },
          ],
        }),
      ),
    /contains duplicate feed 'kjfk-tower'/,
  );
});

test("provider attribution and stream URLs must be concrete credential-free HTTPS URLs", () => {
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          providers: [
            {
              id: "community-jfk",
              label: "JFK Community Receiver",
            },
          ],
          sources: [],
        }),
      ),
    /providers\[0\]\.attributionUrl must be a non-empty string/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          providers: [
            {
              id: "community-jfk",
              label: "JFK Community Receiver",
              attributionUrl: "http://radio.example.org/about",
            },
          ],
          sources: [],
        }),
      ),
    /providers\[0\]\.attributionUrl must be a concrete HTTPS URL/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "insecure",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower"],
              streamUrl: "http://radio.example.org/tower",
              priority: 10,
              cors: true,
            },
          ],
        }),
      ),
    /sources\[0\]\.streamUrl must be a concrete HTTPS URL/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "credentials",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower"],
              streamUrl: "https://user:secret@radio.example.org/tower",
              priority: 10,
              cors: true,
            },
          ],
        }),
      ),
    /sources\[0\]\.streamUrl must be a concrete HTTPS URL/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "wildcard",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower"],
              streamUrl: "https://*.example.org/tower",
              priority: 10,
              cors: true,
            },
          ],
        }),
      ),
    /sources\[0\]\.streamUrl must be a concrete HTTPS URL/,
  );
});

test("source priority and CORS capability use strict validated types", () => {
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "bad-priority",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower"],
              streamUrl: "https://radio.example.org/tower",
              priority: -1,
              cors: true,
            },
          ],
        }),
      ),
    /priority must be an integer between 0 and 1000000/,
  );
  assert.throws(
    () =>
      createAtcSourceRegistry(
        config({
          sources: [
            {
              id: "bad-cors",
              providerId: "community-jfk",
              feedIds: ["kjfk-tower"],
              streamUrl: "https://radio.example.org/tower",
              priority: 10,
              cors: "true",
            },
          ],
        }),
      ),
    /cors must be a boolean/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import nextConfig, {
  buildContentSecurityPolicy,
} from "../../../next.config";
import {
  getDirectTraceProviderPolicies,
} from "@/lib/trails/providers";

function getDirectiveEntries(cspHeader: string, directive: string): string[] {
  const match = cspHeader.match(new RegExp(`${directive}\\s+([^;]+);?`));
  return match ? match[1].trim().split(/\s+/) : [];
}

test("browser-direct trail providers are allowed by the CSP connect-src list", async () => {
  const headerConfigs = await nextConfig.headers?.();
  const globalHeaders = headerConfigs?.find((entry) => entry.source === "/(.*)");
  const cspHeader = globalHeaders?.headers.find(
    (header) => header.key === "Content-Security-Policy",
  )?.value;

  assert.ok(cspHeader, "Expected a Content-Security-Policy header");

  const connectSrcEntries = getDirectiveEntries(cspHeader, "connect-src");

  for (const provider of getDirectTraceProviderPolicies()) {
    const origin = new URL(provider.baseUrl).origin;
    assert.ok(
      connectSrcEntries.includes(origin),
      `Expected CSP connect-src to allow ${origin} for ${provider.id}`,
    );
  }
});

test("ATC audio origins are allowed only through media-src", async () => {
  const headerConfigs = await nextConfig.headers?.();
  const globalHeaders = headerConfigs?.find((entry) => entry.source === "/(.*)");
  const cspHeader = globalHeaders?.headers.find(
    (header) => header.key === "Content-Security-Policy",
  )?.value;

  assert.ok(cspHeader, "Expected a Content-Security-Policy header");

  const mediaSrcEntries = getDirectiveEntries(cspHeader, "media-src");
  assert.ok(mediaSrcEntries.includes("'self'"));
  assert.ok(mediaSrcEntries.includes("https://*.liveatc.net"));
});

test("validated custom ATC origins are included in media-src", () => {
  const previous = process.env.ATC_CUSTOM_SOURCES_JSON;
  process.env.ATC_CUSTOM_SOURCES_JSON = JSON.stringify({
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
  });

  try {
    const cspHeader = buildContentSecurityPolicy();
    assert.ok(
      getDirectiveEntries(cspHeader, "media-src").includes(
        "https://radio.example.org:8443",
      ),
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ATC_CUSTOM_SOURCES_JSON;
    } else {
      process.env.ATC_CUSTOM_SOURCES_JSON = previous;
    }
  }
});

test("invalid ATC source configuration stops CSP construction clearly", () => {
  const previous = process.env.ATC_CUSTOM_SOURCES_JSON;
  process.env.ATC_CUSTOM_SOURCES_JSON = "{invalid";

  try {
    assert.throws(
      () => buildContentSecurityPolicy(),
      /Invalid ATC_CUSTOM_SOURCES_JSON: value must be valid JSON/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ATC_CUSTOM_SOURCES_JSON;
    } else {
      process.env.ATC_CUSTOM_SOURCES_JSON = previous;
    }
  }
});

test("cacheable ATC API responses are excluded from the global no-store rule", async () => {
  const headerConfigs = await nextConfig.headers?.();
  const noStoreHeaders = headerConfigs?.find((entry) =>
    entry.headers.some(
      (header) =>
        header.key === "Cache-Control" &&
        header.value === "no-store, max-age=0",
    ),
  );

  assert.equal(
    noStoreHeaders?.source,
    "/api/((?!routes(?:/|$)|atc/(?:sources|stream)(?:/|$)).*)",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReadsbTraceUrls,
  fetchReadsbDirectTrack,
  getDirectTraceProviders,
  getResponseValidators,
} from "./readsb-direct-client";

test("direct client only advertises providers currently verified as browser-safe", () => {
  assert.deepEqual(getDirectTraceProviders(), ["airplanes-live"]);
});

test("direct client builds full and recent trace URLs for a direct provider", () => {
  assert.deepEqual(buildReadsbTraceUrls("airplanes-live", "3c66b0"), [
    "https://globe.airplanes.live/data/traces/b0/trace_full_3c66b0.json",
    "https://globe.airplanes.live/data/traces/b0/trace_recent_3c66b0.json",
  ]);
});

test("response validators extract etag and last-modified when present", () => {
  const headers = new Headers({
    etag: 'W/"demo"',
    "last-modified": "Fri, 03 Apr 2026 18:06:45 GMT",
  });

  assert.deepEqual(getResponseValidators(headers), {
    etag: 'W/"demo"',
    lastModified: "Fri, 03 Apr 2026 18:06:45 GMT",
  });
});

test("direct trace fetch rethrows aborts instead of treating them as missing data", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const abortError = new DOMException(
    "The operation was aborted.",
    "AbortError",
  );

  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    throw abortError;
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchReadsbDirectTrack("airplanes-live", "3c66b0"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "AbortError");
        return true;
      },
    );

    assert.deepEqual(requestedUrls, [
      "https://globe.airplanes.live/data/traces/b0/trace_full_3c66b0.json",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

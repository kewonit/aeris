import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReadsbTraceUrls,
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

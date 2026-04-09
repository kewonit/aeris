import assert from "node:assert/strict";
import test from "node:test";

import { deriveAircraftPhotosFlags } from "./use-aircraft-photos";

test("deriveAircraftPhotosFlags reports an error for failed negative cache entries", () => {
  assert.deepEqual(
    deriveAircraftPhotosFlags({
      hasIcao24: true,
      fallbackResult: { failed: true },
      cacheKey: "abc123",
      errorKey: "abc123",
      resolvedKey: null,
    }),
    {
      loading: false,
      error: true,
    },
  );
});

test("deriveAircraftPhotosFlags keeps successful empty cache entries non-erroring", () => {
  assert.deepEqual(
    deriveAircraftPhotosFlags({
      hasIcao24: true,
      fallbackResult: { failed: false },
      cacheKey: "abc123",
      errorKey: null,
      resolvedKey: "abc123",
    }),
    {
      loading: false,
      error: false,
    },
  );
});

test("deriveAircraftPhotosFlags stays loading while a request is still pending", () => {
  assert.deepEqual(
    deriveAircraftPhotosFlags({
      hasIcao24: true,
      fallbackResult: null,
      cacheKey: "abc123",
      errorKey: null,
      resolvedKey: null,
    }),
    {
      loading: true,
      error: false,
    },
  );
});

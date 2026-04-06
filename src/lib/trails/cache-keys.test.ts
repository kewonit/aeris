import assert from "node:assert/strict";
import test from "node:test";

import { makeGeometryCacheKey, makeHistoryRequestKey } from "./cache-keys";

test("history request key includes provider identity", () => {
  const a = makeHistoryRequestKey({
    icao24: "3c66b0",
    provider: "adsb-fi",
    mode: "full",
    selectionGeneration: 4,
  });

  const b = makeHistoryRequestKey({
    icao24: "3c66b0",
    provider: "airplanes-live",
    mode: "full",
    selectionGeneration: 4,
  });

  assert.notStrictEqual(a, b);
});

test("geometry cache key changes when provider or selection generation changes", () => {
  const base = {
    icao24: "3c66b0",
    liveRevision: 10,
    historyRevision: 5,
    outcome: "full-history" as const,
  };

  const a = makeGeometryCacheKey({
    ...base,
    provider: "adsb-fi",
    selectionGeneration: 2,
  });

  const b = makeGeometryCacheKey({
    ...base,
    provider: "adsb-fi",
    selectionGeneration: 3,
  });

  const c = makeGeometryCacheKey({
    ...base,
    provider: "airplanes-live",
    selectionGeneration: 2,
  });

  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
});

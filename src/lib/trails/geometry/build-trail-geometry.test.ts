import assert from "node:assert/strict";
import test from "node:test";

import type { TrailEnvelope, TrailSnapshot } from "../types";
import { buildTrailGeometry } from "./build-trail-geometry";

function liveSample(overrides: Partial<TrailSnapshot>): TrailSnapshot {
  return {
    source: "live",
    timestamp: 0,
    lng: 0,
    lat: 0,
    altitude: 10_000,
    track: 90,
    groundSpeed: 220,
    quality: "authoritative-live",
    onGround: false,
    ...overrides,
  };
}

function historySample(overrides: Partial<TrailSnapshot>): TrailSnapshot {
  return {
    source: "adsb-fi",
    timestamp: 0,
    lng: 0,
    lat: 0,
    altitude: 10_000,
    track: 90,
    groundSpeed: 220,
    quality: "authoritative-trace",
    onGround: false,
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<TrailEnvelope> = {}): TrailEnvelope {
  return {
    icao24: "3c66b0",
    provider: "adsb-fi",
    outcome: "provider-unavailable",
    selectionGeneration: 1,
    liveRevision: 1,
    historyRevision: 0,
    lastSeenAt: 2_000,
    liveTail: [],
    historySegments: [],
    entry: null,
    ...overrides,
  };
}

test("falls back to live-tail-only when the history gap is implausibly large", () => {
  const result = buildTrailGeometry(
    makeEnvelope({
      liveTail: [
        liveSample({ timestamp: 1_000, lng: 8.0, lat: 50.0 }),
        liveSample({ timestamp: 1_010, lng: 8.01, lat: 50.0 }),
      ],
      historyRevision: 1,
      historySegments: [
        {
          kind: "historical",
          provider: "adsb-fi",
          samples: [
            historySample({ timestamp: 100, lng: -40.0, lat: 10.0 }),
            historySample({ timestamp: 200, lng: -39.5, lat: 10.5 }),
          ],
        },
      ],
    }),
  );

  assert.equal(result.outcome, "live-tail-only");
});

test("preserves waypoint order through antimeridian normalization", () => {
  const result = buildTrailGeometry(
    makeEnvelope({
      historyRevision: 1,
      historySegments: [
        {
          kind: "historical",
          provider: "adsb-fi",
          samples: [
            historySample({ timestamp: 1, lng: 179.7, lat: 55.0 }),
            historySample({ timestamp: 2, lng: -179.8, lat: 55.1 }),
          ],
        },
      ],
    }),
  );

  assert.ok(result.path.length >= 2);
  assert.deepEqual(result.timestamps, [1, 2]);
});

test("does not invent zero-altitude bridge valleys when all altitudes are null", () => {
  const result = buildTrailGeometry(
    makeEnvelope({
      historyRevision: 1,
      liveTail: [
        liveSample({
          timestamp: 2_000,
          lng: 8.1,
          lat: 50.0,
          altitude: null,
        }),
      ],
      historySegments: [
        {
          kind: "historical",
          provider: "adsb-fi",
          samples: [
            historySample({
              timestamp: 1_900,
              lng: 8.0,
              lat: 50.0,
              altitude: null,
            }),
          ],
        },
      ],
    }),
  );

  assert.equal(
    result.altitudes.every((value) => value === null),
    true,
  );
});

test("keeps canonical live-tail geometry fixed without adding a derived head anchor", () => {
  const result = buildTrailGeometry(
    makeEnvelope({
      liveTail: [
        liveSample({ timestamp: 1_000, lng: 8.0, lat: 50.0 }),
        liveSample({ timestamp: 1_010, lng: 8.1, lat: 50.0 }),
        liveSample({ timestamp: 1_020, lng: 8.2, lat: 50.0 }),
      ],
    }),
  );

  assert.equal(result.outcome, "live-tail-only");
  assert.deepEqual(result.path, [
    [8.0, 50.0],
    [8.1, 50.0],
    [8.2, 50.0],
  ]);
  assert.deepEqual(result.altitudes, [10_000, 10_000, 10_000]);
});

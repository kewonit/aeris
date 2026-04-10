import assert from "node:assert/strict";
import test from "node:test";

import type { TrailSegment, TrailSnapshot } from "../types";

import { mergeSegments } from "./merge-segments";

function historySample(overrides: Partial<TrailSnapshot>): TrailSnapshot {
  return {
    source: "adsb-fi",
    timestamp: 0,
    lng: 0,
    lat: 0,
    altitude: 8_000,
    track: 90,
    groundSpeed: 220,
    quality: "authoritative-trace",
    onGround: false,
    ...overrides,
  };
}

function liveSample(overrides: Partial<TrailSnapshot>): TrailSnapshot {
  return {
    source: "live",
    timestamp: 0,
    lng: 0,
    lat: 0,
    altitude: 8_000,
    track: 250,
    groundSpeed: 220,
    quality: "authoritative-live",
    onGround: false,
    ...overrides,
  };
}

function historySegment(samples: TrailSnapshot[]): TrailSegment {
  return {
    kind: "historical",
    provider: "adsb-fi",
    samples,
  };
}

test("mergeSegments prefers the trailing history tail when history passes near the live head more than once", () => {
  const result = mergeSegments({
    referenceAltitude: 8_000,
    historySegments: [
      historySegment([
        historySample({ timestamp: 100, lng: 72.9, lat: 19.22 }),
        historySample({ timestamp: 200, lng: 72.95, lat: 19.18 }),
        historySample({ timestamp: 260, lng: 73.1, lat: 19.3 }),
        historySample({ timestamp: 320, lng: 72.96, lat: 19.18 }),
      ]),
    ],
    liveTail: [
      liveSample({ timestamp: 330, lng: 72.95, lat: 19.18 }),
      liveSample({ timestamp: 340, lng: 72.93, lat: 19.17 }),
    ],
  });

  assert.equal(result.outcome, "full-history");
  assert.deepEqual(
    result.samples[result.samples.length - 2],
    historySample({ timestamp: 320, lng: 72.96, lat: 19.18 }),
  );
  assert.deepEqual(
    result.historyBody[result.historyBody.length - 1],
    historySample({ timestamp: 320, lng: 72.96, lat: 19.18 }),
  );
  assert.deepEqual(result.liveContinuation[0], {
    ...liveSample({ timestamp: 330, lng: 72.95, lat: 19.18 }),
    lng: 72.96,
    lat: 19.18,
    altitude: 8_000,
  });
});

test("mergeSegments degrades instead of snapping to an older interior branch when the real tail is stale and far away", () => {
  const liveTail = [
    liveSample({
      timestamp: 2_200_000,
      lng: 72.95,
      lat: 19.18,
      altitude: 4_200,
    }),
    liveSample({
      timestamp: 2_200_010,
      lng: 72.93,
      lat: 19.17,
      altitude: 4_200,
    }),
  ];

  const result = mergeSegments({
    referenceAltitude: 4_200,
    historySegments: [
      historySegment([
        historySample({
          timestamp: 100,
          lng: 72.95,
          lat: 19.18,
          altitude: 4_000,
        }),
        historySample({
          timestamp: 200,
          lng: 73.3,
          lat: 19.23,
          altitude: 4_100,
        }),
        historySample({
          timestamp: 300,
          lng: 73.58,
          lat: 19.44,
          altitude: 4_200,
        }),
      ]),
    ],
    liveTail,
  });

  assert.equal(result.outcome, "partial-history");
  assert.equal(result.historyBody.length, 3);
  assert.ok(result.bridge.length > 0, "should build a bridge across the gap");
  assert.deepEqual(result.liveContinuation, liveTail);
  assert.ok(
    result.samples.length > liveTail.length,
    "samples should include history + bridge + live",
  );
});

test("mergeSegments drops a suspect bootstrap prefix before joining selected history to live samples", () => {
  const result = mergeSegments({
    referenceAltitude: 4_300,
    historySegments: [
      historySegment([
        historySample({
          timestamp: 100,
          lng: 72.8,
          lat: 19.0,
          altitude: 4_000,
        }),
        historySample({
          timestamp: 200,
          lng: 72.9,
          lat: 19.1,
          altitude: 4_100,
        }),
      ]),
    ],
    liveTail: [
      liveSample({
        timestamp: 210,
        lng: 72.62,
        lat: 18.82,
        altitude: 4_100,
        quality: "suspect",
      }),
      liveSample({
        timestamp: 220,
        lng: 72.71,
        lat: 18.9,
        altitude: 4_150,
        quality: "suspect",
      }),
      liveSample({
        timestamp: 230,
        lng: 72.91,
        lat: 19.11,
        altitude: 4_220,
      }),
      liveSample({
        timestamp: 240,
        lng: 72.94,
        lat: 19.13,
        altitude: 4_300,
      }),
    ],
  });

  assert.equal(result.outcome, "full-history");
  assert.equal(
    result.samples.some((sample) => sample.quality === "suspect"),
    false,
  );
  assert.deepEqual(
    result.historyBody[result.historyBody.length - 1],
    historySample({
      timestamp: 200,
      lng: 72.9,
      lat: 19.1,
      altitude: 4_100,
    }),
  );
  assert.deepEqual(result.liveContinuation[0], {
    ...liveSample({
      timestamp: 230,
      lng: 72.91,
      lat: 19.11,
      altitude: 4_220,
    }),
    lng: 72.9,
    lat: 19.1,
    altitude: 4_220,
  });
});

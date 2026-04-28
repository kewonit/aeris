import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  computeInterpolatedFlights,
  getSafeInterpolationProgress,
  resolveDisplayTrack,
} from "./flight-interpolation";

test("resolveDisplayTrack prefers the actual motion bearing when movement is available", () => {
  const resolved = resolveDisplayTrack({
    reportedTrack: 100,
    previousPosition: { lng: 8.0, lat: 50.0 },
    currentPosition: { lng: 8.01, lat: 50.0 },
  });

  assert.equal(resolved, 90);
});

test("computeInterpolatedFlights uses motion-aligned heading instead of the raw reported track", () => {
  const flight = {
    icao24: "abc123",
    longitude: 8.01,
    latitude: 50.0,
    baroAltitude: 1000,
    trueTrack: 100,
    velocity: 220,
  } as FlightState;

  const interpolated = computeInterpolatedFlights(
    [flight],
    new Map([[flight.icao24, { lng: 8.0, lat: 50.0, alt: 1000, track: 100 }]]),
    new Map([[flight.icao24, { lng: 8.01, lat: 50.0, alt: 1000, track: 100 }]]),
    0.5,
    0.5,
    0.5,
    30_000,
  );

  assert.equal(Math.round(interpolated[0].trueTrack ?? 0), 90);
});

test("getSafeInterpolationProgress freezes at the current snapshot while the page is inactive", () => {
  const progress = getSafeInterpolationProgress({
    elapsedMs: 120_000,
    animDurationMs: 8_000,
    pageActive: false,
  });

  assert.equal(progress.rawT, 1);
  assert.equal(progress.tPos, 1);
});

test("getSafeInterpolationProgress freezes stale active data at the current snapshot", () => {
  const progress = getSafeInterpolationProgress({
    elapsedMs: 16_000,
    animDurationMs: 8_000,
    pageActive: true,
    staleThresholdMs: 15_000,
  });

  assert.equal(progress.rawT, 1);
  assert.equal(progress.tPos, 1);
});

test("getSafeInterpolationProgress bounds active dead reckoning to a small window", () => {
  const progress = getSafeInterpolationProgress({
    elapsedMs: 40_000,
    animDurationMs: 8_000,
    pageActive: true,
    staleThresholdMs: 60_000,
    maxExtrapolationMs: 2_000,
  });

  assert.equal(progress.rawT, 1.25);
  assert.equal(progress.tPos, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";
import type { TrailTrack } from "@/lib/trails/types";

import {
  computeInterpolatedFlights,
  computePitchByIcao,
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

test("resolveDisplayTrack corrects for shorter longitude degrees away from the equator", () => {
  // About one kilometre along a true 125° track at 37° N.
  const resolved = resolveDisplayTrack({
    reportedTrack: null,
    previousPosition: { lng: -122, lat: 37 },
    currentPosition: { lng: -122 + 0.009214, lat: 37 - 0.005153 },
  });

  assert.ok(Math.abs(resolved - 125) < 0.5, `got ${resolved}`);
});

test("resolveDisplayTrack takes the short way across the antimeridian", () => {
  const resolved = resolveDisplayTrack({
    reportedTrack: null,
    previousPosition: { lng: 179.99, lat: 0 },
    currentPosition: { lng: -179.99, lat: 0 },
  });

  assert.ok(Math.abs(resolved - 90) < 0.5, `got ${resolved}`);
});

test("an aircraft pitches along its path as drawn, in either altitude mode", () => {
  // A steady 3° descent at 70 m/s, sampled every 350 m.
  const glide = Math.tan((3 * Math.PI) / 180);
  const stepLng = 350 / (111_320 * Math.cos((50 * Math.PI) / 180));
  const at = (index: number) => ({
    lng: 8 + index * stepLng,
    lat: 50,
    alt: 1_000 - index * 350 * glide,
  });
  const trail: TrailTrack = {
    icao24: "abc123",
    parts: [
      Array.from({ length: 8 }, (_, index) => ({
        t: index * 5_000,
        ...at(index),
        onGround: false,
      })),
    ],
    revision: 1,
    hasHistory: false,
  };
  const flight = {
    icao24: "abc123",
    longitude: at(7).lng,
    latitude: 50,
    baroAltitude: at(7).alt,
    velocity: 70,
    verticalRate: -70 * glide,
  } as FlightState;
  const pitch = (mode: "realistic" | "presentation") =>
    computePitchByIcao(
      [flight],
      new Map([[flight.icao24, trail]]),
      new Map([[flight.icao24, { ...at(7), track: 90 }]]),
      new Map([[flight.icao24, { ...at(6), track: 90 }]]),
      mode,
    ).get(flight.icao24)!;

  // Positive pitch lowers the nose. Below 3,000 m presentation heights are
  // drawn 3 × 1.8 times as tall, so the drawn descent is that much steeper.
  assert.ok(Math.abs(pitch("realistic") - 3) < 0.05);
  const drawn = (Math.atan(5.4 * glide) * 180) / Math.PI;
  assert.ok(Math.abs(pitch("presentation") - drawn) < 0.05);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  carryForward,
  computeInterpolatedFlights,
  displayHeading,
  HEADING_TURN_MS,
  getSafeInterpolationProgress,
  MAX_REPORT_LEAD_MS,
  noteReceipt,
  reportLeadMs,
  resolveDisplayTrack,
  type ReceiptDelays,
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
    30_000,
  );

  assert.equal(Math.round(interpolated[0].trueTrack ?? 0), 90);
});

test("getSafeInterpolationProgress holds at the current snapshot while the page is inactive", () => {
  const progress = getSafeInterpolationProgress({
    elapsedMs: 120_000,
    animDurationMs: 8_000,
    pageActive: false,
  });

  assert.deepEqual(progress, { tPos: 1, moving: false });
});

test("getSafeInterpolationProgress glides on past a late report, then holds", () => {
  const during = getSafeInterpolationProgress({
    elapsedMs: 4_000,
    animDurationMs: 8_000,
    pageActive: true,
  });
  assert.deepEqual(during, { tPos: 0.5, moving: true });

  const late = getSafeInterpolationProgress({
    elapsedMs: 9_000,
    animDurationMs: 8_000,
    pageActive: true,
    maxExtrapolationMs: 2_000,
  });
  assert.deepEqual(late, { tPos: 1.125, moving: true });

  // However late, it never glides further than the bound, and never back.
  for (const elapsedMs of [10_000, 16_000, 120_000]) {
    const held = getSafeInterpolationProgress({
      elapsedMs,
      animDurationMs: 8_000,
      pageActive: true,
      maxExtrapolationMs: 2_000,
    });
    assert.deepEqual(held, { tPos: 1.25, moving: false });
  }
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

test("on a new course the nose turns there from where it pointed, without snapping", () => {
  // It pointed north; the next report sets it moving due east.
  const prev = { lng: 8, lat: 50, alt: 1_000, track: 0, heading: 0 };
  const curr = { lng: 8.01, lat: 50, alt: 1_000, track: 90 };

  assert.equal(displayHeading(prev, curr, 0), 0);
  const halfway = displayHeading(prev, curr, HEADING_TURN_MS / 2);
  assert.ok(halfway > 30 && halfway < 60);
  assert.ok(Math.abs(displayHeading(prev, curr, HEADING_TURN_MS) - 90) < 0.5);
  assert.ok(Math.abs(displayHeading(prev, curr, 4_000) - 90) < 0.5);
});

test("a fresh aircraft points straight along its move", () => {
  const prev = { lng: 8, lat: 50, alt: 1_000, track: 0 };
  const curr = { lng: 8.01, lat: 50, alt: 1_000, track: 90 };

  assert.ok(Math.abs(displayHeading(prev, curr, 0) - 90) < 0.5);
});

function reportFrom(
  provider: string,
  responseTime: number,
  positionAgeSeconds: number | null,
): FlightState {
  return {
    icao24: "abc123",
    longitude: -74,
    latitude: 40.5,
    baroAltitude: 1000,
    trueTrack: 90,
    velocity: 100,
    verticalRate: -5,
    onGround: false,
    provenance: {
      responseTime,
      observationTime: null,
      positionAgeSeconds,
      contributingSources: [provider],
      positionProvider: provider,
    },
  } as FlightState;
}

test("a report's lead is its position age plus however long its answer was cached", () => {
  const delays: ReceiptDelays = new Map();
  // The provider's clock runs 30 s behind ours; answers take 0.5 s.
  const fresh = reportFrom("adsbfi", 1_000_000, 0.4);
  noteReceipt(delays, [fresh], 1_030_500);
  assert.equal(reportLeadMs(fresh, 1_030_500, delays), 400);

  // The next answer sat in a cache for 1.5 s before it was sent.
  const cached = reportFrom("adsbfi", 1_004_000, 0.2);
  noteReceipt(delays, [cached], 1_036_000);
  assert.equal(reportLeadMs(cached, 1_036_000, delays), 1_700);
});

test("each provider is timed against its own answers", () => {
  const delays: ReceiptDelays = new Map();
  const a = reportFrom("adsbfi", 1_000_000, 0);
  const b = reportFrom("opensky", 2_000_000, 3);
  noteReceipt(delays, [a, b], 1_000_200);
  assert.equal(reportLeadMs(a, 1_000_200, delays), 0);
  assert.equal(reportLeadMs(b, 1_000_200, delays), 3_000);
});

test("a report's lead is bounded and never negative", () => {
  const delays: ReceiptDelays = new Map();
  assert.equal(reportLeadMs(reportFrom("x", 1_000, 120), 1_000, delays), MAX_REPORT_LEAD_MS);
  assert.equal(reportLeadMs(reportFrom("x", 1_000, null), 1_000, delays), 0);
  assert.equal(
    reportLeadMs({ ...reportFrom("x", 1_000, 1), provenance: undefined } as unknown as FlightState, 1_000, delays),
    0,
  );
});

test("carryForward flies a report on along its track and climb", () => {
  const moved = carryForward(reportFrom("x", 0, 0), 2_000)!;
  // 200 m east at 40.5° N, and 10 m lower.
  const eastMeters = (moved.lng + 74) * 111_320 * Math.cos((40.5 * Math.PI) / 180);
  assert.ok(Math.abs(eastMeters - 200) < 0.01, `${eastMeters}`);
  assert.ok(Math.abs(moved.lat - 40.5) < 1e-9);
  assert.equal(moved.alt, 990);
});

test("carryForward leaves aircraft on the ground, or without a speed or track, where reported", () => {
  const base = reportFrom("x", 0, 0);
  for (const flight of [
    { ...base, onGround: true },
    { ...base, velocity: null },
    { ...base, trueTrack: null },
  ] as FlightState[]) {
    assert.deepEqual(carryForward(flight, 2_000), { lng: -74, lat: 40.5, alt: 1000 });
  }
  assert.equal(carryForward({ ...base, longitude: null } as FlightState, 2_000), null);
});

test("reports carried forward to their arrival are a poll's flight apart", () => {
  const delays: ReceiptDelays = new Map();
  // Polls arrive every 5.3 s. The provider stamps answers in 2 s steps, so
  // the reported positions are 5.7, 4.2 and 5.9 s of flight apart.
  const polls = [
    { receivedAt: 10_000, responseTime: 9_400, age: 0.3, observed: 9_100 },
    { receivedAt: 15_300, responseTime: 15_400, age: 0.6, observed: 14_800 },
    { receivedAt: 20_600, responseTime: 19_400, age: 0.4, observed: 19_000 },
    { receivedAt: 25_900, responseTime: 25_400, age: 0.5, observed: 24_900 },
  ];
  const eastAt = (seconds: number) => (seconds * 100) / (111_320 * Math.cos((40.5 * Math.PI) / 180));
  const placed = polls.map((poll) => {
    const flight = {
      ...reportFrom("adsbfi", poll.responseTime, poll.age),
      longitude: -74 + eastAt(poll.observed / 1_000),
    } as FlightState;
    noteReceipt(delays, [flight], poll.receivedAt);
    return carryForward(flight, reportLeadMs(flight, poll.receivedAt, delays))!;
  });
  // Every step after the quickest answer covers the same 5.3 s of flight.
  for (let i = 2; i < placed.length; i++) {
    const seconds = (placed[i].lng - placed[i - 1].lng) / eastAt(1);
    assert.ok(Math.abs(seconds - 5.3) < 0.01, `step ${i}: ${seconds}`);
  }
});

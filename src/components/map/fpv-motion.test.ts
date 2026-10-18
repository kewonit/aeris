import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import { createFpvMotion, type FpvState } from "./fpv-motion";

const METERS_PER_DEGREE = 111_320;
const COS_LAT = Math.cos((40 * Math.PI) / 180);

function flight(overrides: Partial<FlightState> = {}): FlightState {
  return {
    icao24: "abc123",
    longitude: -73.8,
    latitude: 40,
    baroAltitude: 3_000,
    trueTrack: 90,
    velocity: 200,
    verticalRate: 0,
    onGround: false,
    provenance: {
      responseTime: 0,
      observationTime: 0,
      positionAgeSeconds: 0,
      contributingSources: [],
      positionProvider: "adsb.lol",
    },
    ...overrides,
  } as FlightState;
}

/** Metres east and north of the first report's position. */
function fromStart(state: FpvState | null): [number, number] {
  assert.ok(state);
  return [
    (state.lng - -73.8) * METERS_PER_DEGREE * COS_LAT,
    (state.lat - 40) * METERS_PER_DEGREE,
  ];
}

test("between reports the aircraft flies on at its speed and track", () => {
  const motion = createFpvMotion();
  motion.observe(flight(), 0);

  const [east, north] = fromStart(motion.stateAt(5_000));
  assert.ok(Math.abs(east - 1_000) < 1);
  assert.ok(Math.abs(north) < 1);
  assert.equal(motion.stateAt(5_000)?.track, 90);
});

test("a new report never jumps the view, and the view settles onto it", () => {
  const motion = createFpvMotion();
  motion.observe(flight(), 0);
  // Five seconds on, the report puts it 300 m north of where it was flown.
  const northLat = 40 + 300 / METERS_PER_DEGREE;
  const reportLng = -73.8 + 1_000 / (METERS_PER_DEGREE * COS_LAT);

  const before = fromStart(motion.stateAt(5_000));
  motion.observe(
    flight({
      longitude: reportLng,
      latitude: northLat,
      provenance: { ...flight().provenance, observationTime: 5_000 },
    }),
    5_000,
  );
  const after = fromStart(motion.stateAt(5_000));
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 0.01);

  const settled = fromStart(motion.stateAt(10_000));
  assert.ok(Math.abs(settled[1] - 300) < 15);
});

test("the view climbs at the reported climb rate", () => {
  const motion = createFpvMotion();
  motion.observe(flight({ verticalRate: 10 }), 0);

  assert.ok(Math.abs(motion.stateAt(5_000)!.alt! - 3_050) < 1e-6);
});

test("a turn carries on smoothly between reports and eases out", () => {
  const motion = createFpvMotion();
  motion.observe(flight({ trueTrack: 0 }), 0);
  const before = motion.stateAt(5_000)!;
  motion.observe(
    flight({
      longitude: before.lng,
      latitude: before.lat,
      trueTrack: 15,
      provenance: { ...flight().provenance, observationTime: 5_000 },
    }),
    5_000,
  );

  const heading = (seconds: number) => motion.stateAt(5_000 + seconds * 1_000)!.track!;
  // No jump on the report: it turns on from where it was shown...
  assert.ok(Math.abs(heading(0) - before.track!) < 1e-6);
  for (let second = 0; second < 6; second += 1) {
    assert.ok(heading(second + 1) > heading(second));
  }
  // ...past the reported 15° at 3°/s, easing out rather than turning on.
  assert.ok(heading(5) > 20 && heading(5) < 15 + 3 * 5);
});

test("a report far from where it was flown is a new position, not a correction", () => {
  const motion = createFpvMotion();
  motion.observe(flight(), 0);
  const farLng = -73.8 + 20_000 / (METERS_PER_DEGREE * COS_LAT);
  motion.observe(
    flight({
      longitude: farLng,
      provenance: { ...flight().provenance, observationTime: 1_000 },
    }),
    1_000,
  );

  assert.ok(Math.abs(motion.stateAt(1_000)!.lng - farLng) < 1e-9);
});

test("without speed it holds still, and missing track or altitude keep the last", () => {
  const motion = createFpvMotion();
  motion.observe(flight({ velocity: null }), 0);
  const [east, north] = fromStart(motion.stateAt(10_000));
  assert.ok(Math.hypot(east, north) < 1e-6);

  motion.observe(
    flight({
      velocity: null,
      trueTrack: null,
      baroAltitude: null,
      provenance: { ...flight().provenance, observationTime: 11_000 },
    }),
    11_000,
  );
  assert.equal(motion.stateAt(11_000)?.track, 90);
  assert.equal(motion.stateAt(11_000)?.alt, 3_000);
});

test("flies on for a minute and a half after the last report, then holds", () => {
  const motion = createFpvMotion();
  motion.observe(flight(), 0);

  const [east] = fromStart(motion.stateAt(60_000));
  assert.ok(Math.abs(east - 12_000) < 1);
  assert.deepEqual(motion.stateAt(120_000), motion.stateAt(90_000));
});

test("a descent that stops being reported touches down and rolls out", () => {
  const motion = createFpvMotion();
  // 60 m up at 70 m/s, coming down at 4 m/s: on the runway in 15 s.
  motion.observe(
    flight({ baroAltitude: 60, velocity: 70, verticalRate: -4 }),
    0,
  );

  assert.ok(Math.abs(motion.stateAt(7_500)!.alt! - 30) < 1e-6);
  assert.equal(motion.stateAt(15_000)!.alt, 0);
  assert.equal(motion.stateAt(40_000)!.alt, 0);
  // Braking at 2 m/s² from 70 m/s reaches taxiing speed 31 s after touchdown.
  const metresEast = (at: number) => fromStart(motion.stateAt(at))[0];
  // Metres covered in the second around a moment.
  const speedAt = (at: number) => metresEast(at + 500) - metresEast(at - 500);
  assert.ok(Math.abs(speedAt(10_000) - 70) < 0.5);
  assert.ok(Math.abs(speedAt(25_000) - 50) < 0.5);
  assert.ok(Math.abs(speedAt(60_000) - 8) < 0.5);
});

test("on the ground it rolls at its reported speed, straight down the runway", () => {
  const motion = createFpvMotion();
  motion.observe(flight({ trueTrack: 0 }), 0);
  motion.observe(
    flight({
      onGround: true,
      baroAltitude: null,
      velocity: 6,
      trueTrack: 10,
      provenance: { ...flight().provenance, observationTime: 5_000 },
    }),
    5_000,
  );
  const later = motion.stateAt(15_000)!;
  assert.equal(later.alt, 0);
  // The turn between the two reports is not carried on along the ground.
  assert.ok(Math.abs(later.track! - 10) < 1e-6);
});

test("a report's position age places it that far back in time", () => {
  const motion = createFpvMotion();
  motion.observe(
    flight({ provenance: { ...flight().provenance, positionAgeSeconds: 2 } }),
    10_000,
  );

  const [east] = fromStart(motion.stateAt(10_000));
  assert.ok(Math.abs(east - 400) < 1);
});

test("a given lead, which counts time in a cache too, overrides the position age", () => {
  const motion = createFpvMotion();
  motion.observe(
    flight({ provenance: { ...flight().provenance, positionAgeSeconds: 2 } }),
    10_000,
    3_000,
  );

  const [east] = fromStart(motion.stateAt(10_000));
  assert.ok(Math.abs(east - 600) < 1);
});

test("a repeated or older report changes nothing", () => {
  const motion = createFpvMotion();
  motion.observe(flight(), 0);
  const before = motion.stateAt(3_000);
  motion.observe(flight(), 3_000);
  assert.deepEqual(motion.stateAt(3_000), before);

  motion.observe(
    flight({
      latitude: 40.01,
      provenance: { ...flight().provenance, positionAgeSeconds: 10 },
    }),
    3_000,
  );
  assert.deepEqual(motion.stateAt(3_000), before);
});

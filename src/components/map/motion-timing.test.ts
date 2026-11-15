import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";
import type { Snapshot } from "./flight-layer-constants";
import {
  angleDelta,
  horizontalDistanceFromLngLat,
  lerpAngle,
} from "./flight-math";
import {
  carryForward,
  computeInterpolatedFlights,
  displayHeading,
  getSafeInterpolationProgress,
  isBackwardMove,
  isDiscontinuity,
  lerpSnapshot,
  nextMoveDuration,
  resolveDisplayTrack,
} from "./flight-interpolation";

const LIMITS = { minMs: 1_000, maxMs: 30_000 };

function run(observed: number[]) {
  let intervals: number[] = [];
  const durations: number[] = [];
  for (const ms of observed) {
    const next = nextMoveDuration(intervals, ms, LIMITS);
    intervals = next.intervals;
    durations.push(next.durationMs);
  }
  return { durations, intervals };
}

test("a forced poll that lands early still starts a move a poll long", () => {
  // Steady five-second polls, then one forced a second after the last.
  const { durations, intervals } = run([5_000, 5_000, 5_000, 1_000, 4_000]);
  assert.equal(durations[3], 5_000);
  assert.equal(durations[4], 5_000);
  assert.ok(!intervals.includes(1_000), "the forced poll is not remembered");
});

test("a burst of forced polls cannot drag the usual interval down", () => {
  const { durations } = run([5_000, 5_000, 5_000, 900, 800, 1_000, 700]);
  assert.ok(durations.every((ms) => ms === 5_000));
});

test("a slower feed lengthens moves, and one slow tick does not", () => {
  assert.equal(run([5_000, 5_000, 20_000]).durations[2], 5_000);
  assert.equal(run([5_000, 8_000, 8_000, 8_000]).durations[3], 8_000);
});

test("angles wrap the short way, whatever their range", () => {
  assert.equal(angleDelta(350, 10), 20);
  assert.equal(angleDelta(10, 350), -20);
  assert.equal(angleDelta(710, 10), 20);
  assert.equal(angleDelta(-30, 30), 60);
  assert.equal(lerpAngle(350, 10, 0.5), 360);
});

test("the nose keeps to the reported track when a move runs backwards", () => {
  // Reported east; the drawn move runs west, as a correction would.
  const track = resolveDisplayTrack({
    reportedTrack: 90,
    previousPosition: { lng: 8.01, lat: 50 },
    currentPosition: { lng: 8.0, lat: 50 },
  });
  assert.equal(track, 90);
  // A small wobble still follows the move, so the nose never crabs.
  const wobble = resolveDisplayTrack({
    reportedTrack: 100,
    previousPosition: { lng: 8.0, lat: 50 },
    currentPosition: { lng: 8.01, lat: 50 },
  });
  assert.equal(wobble, 90);
});

test("a flying aircraft never moves backwards, a taxiing one may", () => {
  const flying = { onGround: false, velocity: 230, trueTrack: 90 } as FlightState;
  const taxiing = { onGround: true, velocity: 8, trueTrack: 90 } as FlightState;
  const back = [{ lng: 8.01, lat: 50 }, { lng: 8.0, lat: 50 }] as const;
  const ahead = [{ lng: 8.0, lat: 50 }, { lng: 8.01, lat: 50 }] as const;
  assert.equal(isBackwardMove(back[0], back[1], flying), true);
  assert.equal(isBackwardMove(ahead[0], ahead[1], flying), false);
  assert.equal(isBackwardMove(back[0], back[1], taxiing), false);
});

const cruising = {
  icao24: "abc123",
  longitude: 8,
  latitude: 50,
  baroAltitude: 11_000,
  velocity: 240,
  trueTrack: 90,
  verticalRate: 0,
  onGround: false,
} as FlightState;

test("a new aircraft flies at its true speed from its first frame", () => {
  // Seeded one move back along its track, as the snapshot effect does.
  const moveMs = 5_000;
  const back = carryForward(cruising, -moveMs)!;
  const at = carryForward(cruising, 0)!;
  const prev: Snapshot = { lng: back.lng, lat: back.lat, alt: back.alt!, track: 90 };
  const curr: Snapshot = { lng: at.lng, lat: at.lat, alt: at.alt!, track: 90 };
  const frame = (t: number) =>
    computeInterpolatedFlights(
      [cruising],
      new Map([["abc123", prev]]),
      new Map([["abc123", curr]]),
      t,
      moveMs,
    )[0];
  const a = frame(0);
  const b = frame(0.2);
  const meters = horizontalDistanceFromLngLat(
    a.longitude!,
    a.latitude!,
    b.longitude!,
    b.latitude!,
  );
  // A fifth of a five-second move at 240 m/s is 240 m.
  assert.ok(Math.abs(meters - 240) < 3, `moved ${meters} m`);
  assert.equal(Math.round(b.trueTrack!), 90);
});

test("a jump no aircraft could fly snaps, and a normal move does not", () => {
  const from = { lng: 8, lat: 50 };
  const twentyKmEast = { lng: 8 + 20_000 / (111_320 * Math.cos((50 * Math.PI) / 180)), lat: 50 };
  const oneMoveEast = { lng: 8 + 1_200 / (111_320 * Math.cos((50 * Math.PI) / 180)), lat: 50 };
  assert.equal(isDiscontinuity(from, twentyKmEast, 5_000, 240), true);
  assert.equal(isDiscontinuity(from, oneMoveEast, 5_000, 240), false);
  // A slow feed's long move is no jump, and a taxiing aircraft's small one is not.
  assert.equal(isDiscontinuity(from, twentyKmEast, 40_000, 240), false);
  assert.equal(isDiscontinuity(from, { lng: 8.01, lat: 50 }, 5_000, 8), false);
});

test("crossing the 180th meridian is a short step, not a lap of the world", () => {
  const west: Snapshot = { lng: 179.99, lat: 0, alt: 0, track: 90 };
  const east: Snapshot = { lng: -179.99, lat: 0, alt: 0, track: 90 };
  assert.equal(isDiscontinuity(west, east, 5_000, 240), false);
  const mid = lerpSnapshot(west, east, 0.5);
  assert.ok(Math.abs(Math.abs(mid.lng) - 180) < 1e-9, `mid at ${mid.lng}`);
  const later = lerpSnapshot(west, east, 0.75);
  assert.ok(later.lng < -179.99 + 0.01 && later.lng > -180, `later at ${later.lng}`);
});

test("without a reported track the nose follows the move, not north", () => {
  const prev: Snapshot = { lng: 8, lat: 50, alt: 0, track: 0, trackKnown: false };
  const curr: Snapshot = { lng: 8.02, lat: 50, alt: 0, track: 0, trackKnown: false };
  assert.equal(Math.round(displayHeading(prev, curr, 2_000)), 90);
});

test("a report carried back goes back along its track", () => {
  const back = carryForward(cruising, -10_000)!;
  assert.ok(back.lng < cruising.longitude!);
  assert.equal(back.lat, cruising.latitude);
});

test("a poll 10 s late leaves traffic flying on at the same speed", () => {
  const moveMs = 5_000;
  const back = carryForward(cruising, -moveMs)!;
  const at = carryForward(cruising, 0)!;
  const prev: Snapshot = { lng: back.lng, lat: back.lat, alt: back.alt!, track: 90 };
  const curr: Snapshot = { lng: at.lng, lat: at.lat, alt: at.alt!, track: 90 };
  const drawnAt = (elapsedMs: number, flight: FlightState) => {
    const { tPos, moving } = getSafeInterpolationProgress({
      elapsedMs,
      animDurationMs: moveMs,
      pageActive: true,
    });
    const [f] = computeInterpolatedFlights(
      [flight],
      new Map([["abc123", prev]]),
      new Map([["abc123", curr]]),
      tPos,
      moveMs,
    );
    return { f, moving };
  };
  const a = drawnAt(14_000, cruising);
  const b = drawnAt(15_000, cruising);
  assert.equal(b.moving, true);
  const meters = horizontalDistanceFromLngLat(
    a.f.longitude!,
    a.f.latitude!,
    b.f.longitude!,
    b.f.latitude!,
  );
  // Still 240 m a second: neither parked nor sped up.
  assert.ok(Math.abs(meters - 240) < 3, `moved ${meters} m`);

  // On the ground it stops two seconds past its report.
  const taxiing = { ...cruising, onGround: true } as FlightState;
  const c = drawnAt(9_000, taxiing).f;
  const d = drawnAt(12_000, taxiing).f;
  assert.equal(c.longitude, d.longitude);
});

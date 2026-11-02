import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";
import { angleDelta, lerpAngle } from "./flight-math";
import {
  isBackwardMove,
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

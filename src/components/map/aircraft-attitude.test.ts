import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  angleOfAttack,
  type Attitude,
  attitudeFor,
  createAttitudeFollower,
  createAttitudeState,
  stepAttitude,
  updateAttitudes,
} from "./aircraft-attitude";

const KNOT = 0.514444;
const FPM = 0.00508;

function flight(overrides: Partial<FlightState> = {}): FlightState {
  return {
    icao24: "abc123",
    onGround: false,
    velocity: 250 * KNOT,
    verticalRate: 0,
    trueTrack: 90,
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

/** Nose-up degrees, the opposite of deck's pitch. */
function noseUp(overrides: Partial<FlightState>): number {
  return -attitudeFor(flight(overrides), null).pitch;
}

test("an airliner on a 3° glide path sits a few degrees nose up", () => {
  // 140 kt and 750 fpm is a 3° glide path, flown slow, wings well up.
  const approach = noseUp({ velocity: 140 * KNOT, verticalRate: -750 * FPM });

  assert.ok(approach > 2 && approach < 4, `got ${approach}`);
});

test("the wings meet the air at a steeper angle the slower they fly", () => {
  assert.equal(angleOfAttack(60), 6);
  assert.equal(angleOfAttack(250), 2.5);
  const mid = angleOfAttack(150);
  assert.ok(mid < 6 && mid > 2.5);
});

test("a steep descent never dives more than 5° nose down", () => {
  const dive = noseUp({ velocity: 250 * KNOT, verticalRate: -6_000 * FPM });

  assert.equal(dive, -5);
});

test("level flight sits a little nose up, a climb out more", () => {
  // Cruise, about 2.5°; slower, lower down, a little more.
  assert.equal(noseUp({ velocity: 460 * KNOT, verticalRate: 0 }), 2.5);
  const level = noseUp({ verticalRate: 0 });
  assert.ok(level > 4 && level < 5, `got ${level}`);
  // Climbing out at 160 kt and 2,500 fpm, about 14°.
  const climb = noseUp({ velocity: 160 * KNOT, verticalRate: 2_500 * FPM });
  assert.ok(climb > 13 && climb < 16, `got ${climb}`);
  assert.equal(noseUp({ velocity: 140 * KNOT, verticalRate: 8_000 * FPM }), 18);
});

test("on the ground, or without a speed, an aircraft sits level", () => {
  assert.deepEqual(attitudeFor(flight({ onGround: true }), 3), {
    pitch: 0,
    bank: 0,
  });
  assert.equal(
    attitudeFor(flight({ velocity: 0, verticalRate: 10 }), null).pitch,
    0,
  );
});

test("a reported roll sets the bank, else the turn rate does", () => {
  assert.equal(attitudeFor(flight({ roll: -18 }), 3).bank, -18);

  // A standard-rate turn at 250 kt banks about 34°, held to an
  // airliner's 25°.
  assert.equal(attitudeFor(flight(), 3).bank, 25);
  // 1.5°/s at 250 kt is about 19° to the right; left turns bank left.
  const right = attitudeFor(flight(), 1.5).bank;
  assert.ok(right > 17 && right < 21, `got ${right}`);
  assert.equal(attitudeFor(flight(), -1.5).bank, -right);
  assert.equal(attitudeFor(flight(), null).bank, 0);
});

test("pitch and bank ease towards each report instead of jumping", () => {
  const state = createAttitudeState();
  updateAttitudes([flight({ verticalRate: 0 })], state, 1_000);
  const level = noseUp({ verticalRate: 0 });
  assert.equal(state.pitch.get("abc123"), -level);

  // The next report starts a descent; a tenth of a second later the nose
  // has only begun to drop.
  updateAttitudes([flight({ verticalRate: -1_500 * FPM })], state, 1_100);
  const early = -state.pitch.get("abc123")!;
  assert.ok(early < level && early > level - 0.5, `got ${early}`);

  let now = 1_100;
  while (now < 8_000) {
    now += 100;
    updateAttitudes([flight({ verticalRate: -1_500 * FPM })], state, now);
  }
  const settled = -state.pitch.get("abc123")!;
  assert.ok(Math.abs(settled - noseUp({ verticalRate: -1_500 * FPM })) < 0.05);
});

test("a turn seen only in tracks holds its bank between reports", () => {
  const state = createAttitudeState();
  const report = (track: number, at: number) =>
    flight({
      trueTrack: track,
      provenance: { ...flight().provenance, observationTime: at },
    });
  updateAttitudes([report(90, 0)], state, 0);
  // 7.5° in 5 s is 1.5°/s to the right.
  let now = 0;
  for (; now < 5_000; now += 100) updateAttitudes([report(90, 0)], state, now);
  for (; now < 10_000; now += 100) updateAttitudes([report(97.5, 5_000)], state, now);
  const midTurn = state.bank.get("abc123")!;
  assert.ok(midTurn > 15, `got ${midTurn}`);

  // Repeats of the same report keep the bank, rather than rocking it level.
  for (; now < 12_000; now += 100) updateAttitudes([report(97.5, 5_000)], state, now);
  assert.ok(state.bank.get("abc123")! >= midTurn - 0.5);
});

test("aircraft no longer reported are forgotten", () => {
  const state = createAttitudeState();
  updateAttitudes([flight()], state, 0);
  updateAttitudes([], state, 100);

  assert.equal(state.pitch.size + state.bank.size + state.tracks.size, 0);
});

/** Steps a follower towards a target at a frame rate, for some seconds. */
function fly(target: Attitude, seconds: number, fps: number, start?: Attitude) {
  const follower = createAttitudeFollower(start ?? { pitch: 0, bank: 0 });
  const frames: { pitch: number; bank: number }[] = [];
  for (let frame = 0; frame < seconds * fps; frame += 1) {
    stepAttitude(follower, target, 1_000 / fps);
    frames.push({ pitch: follower.pitch, bank: follower.bank });
  }
  return { follower, frames };
}

test("rolling into a turn takes seconds, never faster than 5°/s", () => {
  const { frames } = fly({ pitch: 0, bank: 25 }, 10, 60);
  let fastest = 0;
  frames.slice(1).forEach((frame, index) => {
    fastest = Math.max(fastest, Math.abs(frame.bank - frames[index].bank) * 60);
  });
  assert.ok(fastest <= 5 + 1e-9, `rolled at ${fastest}°/s`);
  // Rolls in steadily, takes about six seconds, and never overshoots.
  assert.ok(frames[60].bank > 2 && frames[60].bank < 6, `${frames[60].bank}`);
  assert.ok(Math.abs(frames.at(-1)!.bank - 25) < 0.5);
  assert.ok(Math.max(...frames.map((frame) => frame.bank)) <= 25 + 0.05);
});

test("pitch changes more gently still, never faster than 2°/s", () => {
  const { frames } = fly({ pitch: -10, bank: 0 }, 10, 60);
  let fastest = 0;
  frames.slice(1).forEach((frame, index) => {
    fastest = Math.max(fastest, Math.abs(frame.pitch - frames[index].pitch) * 60);
  });
  assert.ok(fastest <= 2 + 1e-9, `pitched at ${fastest}°/s`);
  assert.ok(Math.abs(frames.at(-1)!.pitch + 10) < 0.5);
});

test("the attitude moves the same at any frame rate", () => {
  const slow = fly({ pitch: -5, bank: -20 }, 3, 24).follower;
  const fast = fly({ pitch: -5, bank: -20 }, 3, 120).follower;
  assert.ok(Math.abs(slow.bank - fast.bank) < 0.05);
  assert.ok(Math.abs(slow.pitch - fast.pitch) < 0.05);
});

test("after a long pause the attitude picks up gently, not all at once", () => {
  const follower = createAttitudeFollower({ pitch: 0, bank: 0 });
  stepAttitude(follower, { pitch: 0, bank: 25 }, 30_000);
  assert.ok(follower.bank <= 5, `jumped to ${follower.bank}`);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  attitudeFor,
  createAttitudeState,
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

test("an airliner descending on a 3° path sits about level, not nose down", () => {
  // 140 kt and 750 fpm is a 3° glide path.
  const approach = noseUp({ velocity: 140 * KNOT, verticalRate: -750 * FPM });

  assert.ok(Math.abs(approach) < 0.5, `got ${approach}`);
});

test("a steep descent never dives more than 5° nose down", () => {
  const dive = noseUp({ velocity: 250 * KNOT, verticalRate: -6_000 * FPM });

  assert.equal(dive, -5);
});

test("level flight sits a little nose up, and a climb more", () => {
  assert.equal(noseUp({ verticalRate: 0 }), 3);
  const climb = noseUp({ velocity: 160 * KNOT, verticalRate: 2_500 * FPM });
  assert.ok(climb > 10 && climb < 13, `got ${climb}`);
  assert.equal(noseUp({ velocity: 140 * KNOT, verticalRate: 8_000 * FPM }), 15);
});

test("on the ground, or without a speed, an aircraft sits level", () => {
  assert.deepEqual(attitudeFor(flight({ onGround: true }), 3), {
    pitch: 0,
    bank: 0,
  });
  assert.equal(noseUp({ velocity: 0, verticalRate: 10 }), 3);
});

test("a reported roll sets the bank, else the turn rate does", () => {
  assert.equal(attitudeFor(flight({ roll: -18 }), 3).bank, -18);

  // A standard-rate turn at 250 kt banks about 34°, held to 30°.
  assert.equal(attitudeFor(flight(), 3).bank, 30);
  // 1.5°/s at 250 kt is about 19° to the right; left turns bank left.
  const right = attitudeFor(flight(), 1.5).bank;
  assert.ok(right > 17 && right < 21, `got ${right}`);
  assert.equal(attitudeFor(flight(), -1.5).bank, -right);
  assert.equal(attitudeFor(flight(), null).bank, 0);
});

test("pitch and bank ease towards each report instead of jumping", () => {
  const state = createAttitudeState();
  updateAttitudes([flight({ verticalRate: 0 })], state, 1_000);
  assert.equal(state.pitch.get("abc123"), -3);

  // The next report starts a descent; a tenth of a second later the nose
  // has only begun to drop.
  updateAttitudes([flight({ verticalRate: -1_500 * FPM })], state, 1_100);
  const early = -state.pitch.get("abc123")!;
  assert.ok(early < 3 && early > 2.5, `got ${early}`);

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

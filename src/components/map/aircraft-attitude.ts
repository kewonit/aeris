import { aircraftVerticalRate } from "@/lib/aircraft-sidebar";
import type { FlightState } from "@/lib/opensky";

const GRAVITY = 9.81;
/**
 * Wings meet the air at an angle that grows as the aircraft slows: about
 * 6° at approach speed, so an airliner on a 3° glide path sits about 3°
 * nose up, falling to about 2.5° at cruise.
 */
const SLOW_ANGLE_OF_ATTACK_DEG = 6;
const FAST_ANGLE_OF_ATTACK_DEG = 2.5;
const SLOW_SPEED_MPS = 70;
const FAST_SPEED_MPS = 230;
/** Airliners rarely pitch further than this, even descending steeply... */
const MAX_NOSE_DOWN_DEG = 5;
/** ...or climbing hard just after take-off. */
const MAX_NOSE_UP_DEG = 18;
/** Below this ground speed the climb angle means nothing; hold level. */
const MIN_PATH_SPEED_MPS = 20;
/** Airliners turn at no more than about this bank. */
const MAX_BANK_DEG = 25;
/** A turn implied by two tracks faster than this is noise, not a turn. */
const MAX_TURN_RATE_DEG_S = 6;
/** Pitch and bank ease towards each report over about this long. */
const PITCH_EASE_MS = 1_500;
const BANK_EASE_MS = 1_000;

/**
 * Pitch and bank in deck's sense: negative pitch raises the nose, positive
 * bank lowers the right wing.
 */
export type Attitude = { pitch: number; bank: number };

type TrackReport = { track: number; at: number; rate: number };

/** Each aircraft's shown attitude, carried from frame to frame. */
export type AttitudeState = {
  pitch: Map<string, number>;
  bank: Map<string, number>;
  tracks: Map<string, TrackReport>;
  lastAt: number;
};

export function createAttitudeState(): AttitudeState {
  return { pitch: new Map(), bank: new Map(), tracks: new Map(), lastAt: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The attitude a real aircraft would hold for its reported motion: its
 * nose follows its true flight path, not the stretched height a map may
 * draw it at, and it banks as a coordinated turn at its speed would.
 *
 * @param turnRate Degrees per second, positive turning right, when the
 *   aircraft reports no roll of its own.
 */
/** The wing's angle to the air at a ground speed, in degrees. */
export function angleOfAttack(speed: number): number {
  const share = clamp(
    (speed - SLOW_SPEED_MPS) / (FAST_SPEED_MPS - SLOW_SPEED_MPS),
    0,
    1,
  );
  return (
    SLOW_ANGLE_OF_ATTACK_DEG +
    (FAST_ANGLE_OF_ATTACK_DEG - SLOW_ANGLE_OF_ATTACK_DEG) * share
  );
}

export function attitudeFor(
  flight: Pick<
    FlightState,
    "onGround" | "velocity" | "verticalRate" | "geomRate" | "roll"
  >,
  turnRate: number | null,
): Attitude {
  if (flight.onGround) return { pitch: 0, bank: 0 };

  const speed = Number.isFinite(flight.velocity) ? flight.velocity! : 0;
  const climb = aircraftVerticalRate(flight);
  const flying = speed >= MIN_PATH_SPEED_MPS;
  const pathDeg =
    flying && climb !== null && Number.isFinite(climb)
      ? (Math.atan2(climb, speed) * 180) / Math.PI
      : 0;
  const noseUp = flying
    ? clamp(pathDeg + angleOfAttack(speed), -MAX_NOSE_DOWN_DEG, MAX_NOSE_UP_DEG)
    : 0;

  let bank = 0;
  if (flight.roll != null && Number.isFinite(flight.roll)) {
    bank = flight.roll;
  } else if (turnRate !== null && speed > 0) {
    const radiansPerSecond = (turnRate * Math.PI) / 180;
    bank = (Math.atan((speed * radiansPerSecond) / GRAVITY) * 180) / Math.PI;
  }

  return {
    pitch: noseUp === 0 ? 0 : -noseUp,
    bank: clamp(bank, -MAX_BANK_DEG, MAX_BANK_DEG),
  };
}

/** How fast the aircraft is turning, from its reported rate or its tracks. */
function turnRateFor(
  flight: FlightState,
  tracks: Map<string, TrackReport>,
  now: number,
): number | null {
  if (flight.trackRate != null && Number.isFinite(flight.trackRate)) {
    return clamp(flight.trackRate, -MAX_TURN_RATE_DEG_S, MAX_TURN_RATE_DEG_S);
  }
  const track = flight.trueTrack;
  if (track == null || !Number.isFinite(track)) return null;

  const at = flight.provenance?.observationTime ?? now;
  const last = tracks.get(flight.icao24);
  if (!last) {
    tracks.set(flight.icao24, { track, at, rate: 0 });
    return 0;
  }
  if (last.track === track && last.at === at) return last.rate;

  const seconds = (at - last.at) / 1_000;
  const turned = ((track - last.track + 540) % 360) - 180;
  const rate =
    seconds >= 1 && seconds <= 30
      ? clamp(turned / seconds, -MAX_TURN_RATE_DEG_S, MAX_TURN_RATE_DEG_S)
      : 0;
  tracks.set(flight.icao24, { track, at, rate });
  return rate;
}

function ease(current: number, target: number, dtMs: number, overMs: number) {
  return current + (target - current) * (1 - Math.exp(-dtMs / overMs));
}

/**
 * Moves every aircraft's shown pitch and bank towards the attitude its
 * latest report implies. They ease rather than jump, so a new report never
 * snaps an aircraft, and a turn holds its bank instead of rocking with
 * each report. Aircraft no longer reported are forgotten.
 */
export function updateAttitudes(
  flights: FlightState[],
  state: AttitudeState,
  now: number,
): void {
  const dtMs = state.lastAt > 0 ? Math.min(now - state.lastAt, 1_000) : 0;
  state.lastAt = now;
  const seen = new Set<string>();

  for (const flight of flights) {
    seen.add(flight.icao24);
    const target = attitudeFor(flight, turnRateFor(flight, state.tracks, now));
    const pitch = state.pitch.get(flight.icao24);
    const bank = state.bank.get(flight.icao24);
    state.pitch.set(
      flight.icao24,
      pitch === undefined ? target.pitch : ease(pitch, target.pitch, dtMs, PITCH_EASE_MS),
    );
    state.bank.set(
      flight.icao24,
      bank === undefined ? target.bank : ease(bank, target.bank, dtMs, BANK_EASE_MS),
    );
  }

  for (const map of [state.pitch, state.bank, state.tracks]) {
    for (const icao24 of map.keys()) {
      if (!seen.has(icao24)) map.delete(icao24);
    }
  }
}

/** An airliner rolls into and out of a turn at about this rate... */
const MAX_ROLL_RATE_DEG_S = 5;
/** ...and pitches more gently still. */
const MAX_PITCH_RATE_DEG_S = 2;
/**
 * How quickly the attitude closes on its target, critically damped: it
 * starts and stops moving smoothly, and settles without overshooting.
 */
const FOLLOW_RATE_PER_S = 2.5;
/** The follower moves in steps no longer than this, at any frame rate. */
const FOLLOW_STEP_S = 1 / 120;
/** After a long pause, as with a hidden tab, it picks up from here. */
const MAX_FOLLOW_GAP_S = 1;

/** A shown attitude that rolls and pitches like an airliner. */
export type AttitudeFollower = Attitude & {
  /** Degrees a second. */
  pitchRate: number;
  bankRate: number;
};

export function createAttitudeFollower(start: Attitude): AttitudeFollower {
  return { pitch: start.pitch, bank: start.bank, pitchRate: 0, bankRate: 0 };
}

function follow(
  value: number,
  rate: number,
  target: number,
  seconds: number,
  maxRate: number,
): [number, number] {
  const k = FOLLOW_RATE_PER_S;
  const acceleration = k * k * (target - value) - 2 * k * rate;
  const nextRate = clamp(rate + acceleration * seconds, -maxRate, maxRate);
  return [value + nextRate * seconds, nextRate];
}

/**
 * Moves a follower `dtMs` towards a target attitude: it rolls no faster
 * than 5°/s and pitches no faster than 2°/s, gathering and losing speed
 * smoothly, so a new target never kicks the aircraft and it holds its
 * bank through a turn.
 */
export function stepAttitude(
  follower: AttitudeFollower,
  target: Attitude,
  dtMs: number,
): void {
  let remaining = Math.min(Math.max(dtMs, 0) / 1_000, MAX_FOLLOW_GAP_S);
  while (remaining > 1e-9) {
    const seconds = Math.min(FOLLOW_STEP_S, remaining);
    remaining -= seconds;
    [follower.pitch, follower.pitchRate] = follow(
      follower.pitch,
      follower.pitchRate,
      target.pitch,
      seconds,
      MAX_PITCH_RATE_DEG_S,
    );
    [follower.bank, follower.bankRate] = follow(
      follower.bank,
      follower.bankRate,
      target.bank,
      seconds,
      MAX_ROLL_RATE_DEG_S,
    );
  }
}

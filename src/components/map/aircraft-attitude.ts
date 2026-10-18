import { aircraftVerticalRate } from "@/lib/aircraft-sidebar";
import type { FlightState } from "@/lib/opensky";

const GRAVITY = 9.81;
/**
 * Wings fly at a small angle to the air, so an airliner holding altitude
 * sits a few degrees nose up, and one descending at 3° sits about level.
 */
const ANGLE_OF_ATTACK_DEG = 3;
/** Airliners rarely pitch further than this, even descending steeply... */
const MAX_NOSE_DOWN_DEG = 5;
/** ...or climbing hard just after take-off. */
const MAX_NOSE_UP_DEG = 15;
/** Below this ground speed the climb angle means nothing; hold level. */
const MIN_PATH_SPEED_MPS = 20;
const MAX_BANK_DEG = 30;
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
  const pathDeg =
    speed >= MIN_PATH_SPEED_MPS && climb !== null && Number.isFinite(climb)
      ? (Math.atan2(climb, speed) * 180) / Math.PI
      : 0;
  const noseUp = clamp(
    pathDeg + ANGLE_OF_ATTACK_DEG,
    -MAX_NOSE_DOWN_DEG,
    MAX_NOSE_UP_DEG,
  );

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

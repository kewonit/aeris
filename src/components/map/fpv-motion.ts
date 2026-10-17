import type { FlightState } from "@/lib/opensky";

const METERS_PER_DEGREE = 111_320;
/**
 * Dead reckoning stops this long after the last report, holding still. An
 * airliner flies straight and level for minutes, so flying on is closer to
 * the truth than stopping in mid-air when reports drop out.
 */
const MAX_DEAD_RECKON_S = 90;
/** On the ground the aircraft brakes at about this rate... */
const ROLLOUT_DECELERATION_MPS2 = 2;
/** ...down to taxiing speed. */
const TAXI_SPEED_MPS = 8;
/** Integration step for the turning path. */
const STEP_S = 0.25;
/** No airliner turns faster than this; faster means noisy tracks. */
const MAX_TURN_RATE_DEG_S = 3;
/** A turn eases out over about this long after the last report. */
const TURN_FADE_S = 8;
/**
 * Where the camera was shown and where a new report puts the aircraft
 * close up over about this long, so a poll never jumps the view.
 */
const CORRECTION_TIME_MS = 1_500;
/** Further apart than this, a report is a new position, not a correction. */
const TELEPORT_METERS = 5_000;
const TELEPORT_ALTITUDE_METERS = 1_500;

/** Where the first person aircraft is, and which way it points. */
export type FpvState = {
  lng: number;
  lat: number;
  /** Barometric altitude in metres, or null until one is reported. */
  alt: number | null;
  /** Track in degrees, or null until one is reported. */
  track: number | null;
};

type Observation = {
  /** Local time of the position, in Unix milliseconds. */
  at: number;
  lng: number;
  lat: number;
  alt: number | null;
  track: number | null;
  /** Ground speed in metres per second. */
  speed: number;
  /** Climb rate in metres per second. */
  climb: number;
  /** Degrees per second, positive turning right. */
  turnRate: number;
};

type Offset = {
  east: number;
  north: number;
  alt: number;
  track: number;
  at: number;
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function wrapDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The signed turn from one heading to another, in -180..180. */
function turnBetween(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Degrees the aircraft has turned `seconds` after an observation. */
function turnedBy(observation: Observation, seconds: number): number {
  // The turn fades out, so heading(t) = track + rate * T * (1 - e^(-t/T)).
  return (
    observation.turnRate * TURN_FADE_S * (1 - Math.exp(-seconds / TURN_FADE_S))
  );
}

/**
 * Where an observation's aircraft is `seconds` later: flying its turn and
 * climb, and once a descent reaches the ground, touching down and braking
 * along its track to taxiing speed. Reports often stop at touchdown, when
 * receivers lose the aircraft behind buildings, so the landing is flown
 * out rather than left hanging over the runway.
 */
function flyOn(observation: Observation, seconds: number): FpvState {
  const duration = Math.min(Math.max(seconds, 0), MAX_DEAD_RECKON_S);
  const { alt, climb, speed, track } = observation;
  let touchdownAt = Infinity;
  if (alt !== null && alt <= 0) touchdownAt = 0;
  else if (alt !== null && climb < 0) touchdownAt = alt / -climb;
  const speedAt = (t: number) =>
    t < touchdownAt || speed <= TAXI_SPEED_MPS
      ? speed
      : Math.max(
          TAXI_SPEED_MPS,
          speed - ROLLOUT_DECELERATION_MPS2 * (t - touchdownAt),
        );

  let east = 0;
  let north = 0;
  let heading = track;
  if (track !== null && speed > 0) {
    for (let t = 0; t < duration; t += STEP_S) {
      const step = Math.min(STEP_S, duration - t);
      const middle = t + step / 2;
      // A landed aircraft rolls straight down the runway.
      const turned = turnedBy(observation, Math.min(middle, touchdownAt));
      const radians = ((track + turned) * Math.PI) / 180;
      east += speedAt(middle) * step * Math.sin(radians);
      north += speedAt(middle) * step * Math.cos(radians);
    }
    heading = wrapDegrees(
      track + turnedBy(observation, Math.min(duration, touchdownAt)),
    );
  }

  const cosLat = Math.cos((observation.lat * Math.PI) / 180);
  return {
    lng: observation.lng + east / (METERS_PER_DEGREE * Math.max(cosLat, 1e-6)),
    lat: observation.lat + north / METERS_PER_DEGREE,
    alt: alt === null ? null : Math.max(0, alt + climb * duration),
    track: heading,
  };
}

/** Metres east and north from one state to another. */
function offsetMeters(from: FpvState, to: FpvState): [number, number] {
  const cosLat = Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180);
  return [
    (((to.lng - from.lng + 540) % 360) - 180) * METERS_PER_DEGREE * cosLat,
    (to.lat - from.lat) * METERS_PER_DEGREE,
  ];
}

/**
 * A smooth, continuous path for the first person aircraft between reports.
 * Altitudes are heights above the map, which puts the ground at zero.
 *
 * Reports arrive every few seconds. Between them the aircraft flies on at
 * its reported speed, climb and turn. When a report arrives, the difference
 * between where it was shown and where the report puts it is kept as an
 * offset that fades away, so the view never jumps and still settles onto
 * the reported track within a couple of seconds.
 */
export function createFpvMotion() {
  let last: Observation | null = null;
  let lastKey: string | null = null;
  let offset: Offset | null = null;

  function predicted(now: number): FpvState | null {
    return last ? flyOn(last, (now - last.at) / 1_000) : null;
  }

  function stateAt(now: number): FpvState | null {
    const base = predicted(now);
    if (!base || !offset) return base;
    const share = Math.exp(-(now - offset.at) / CORRECTION_TIME_MS);
    const cosLat = Math.cos((base.lat * Math.PI) / 180);
    return {
      lng:
        base.lng +
        (offset.east * share) / (METERS_PER_DEGREE * Math.max(cosLat, 1e-6)),
      lat: base.lat + (offset.north * share) / METERS_PER_DEGREE,
      alt: base.alt === null ? null : Math.max(0, base.alt + offset.alt * share),
      track:
        base.track === null ? null : wrapDegrees(base.track + offset.track * share),
    };
  }

  /**
   * Takes in a report of the aircraft, received at `receivedAt`, whose
   * position was true `leadMs` before that (its reported age when unset).
   * Repeats of the same report are ignored, so re-renders do not restart a
   * fade.
   */
  function observe(
    flight: FlightState,
    receivedAt: number,
    leadMs?: number,
  ): void {
    if (!finite(flight.longitude) || !finite(flight.latitude)) return;
    const key = [
      flight.longitude,
      flight.latitude,
      flight.baroAltitude,
      flight.trueTrack,
      flight.provenance?.observationTime,
    ].join("|");
    if (key === lastKey) return;
    lastKey = key;

    const age = flight.provenance?.positionAgeSeconds;
    const at =
      receivedAt -
      (finite(leadMs) && leadMs > 0
        ? leadMs
        : finite(age) && age > 0
          ? age * 1_000
          : 0);
    // A report older than the one in hand would only pull the view back.
    if (last && at < last.at) return;
    const track = finite(flight.trueTrack)
      ? wrapDegrees(flight.trueTrack)
      : (last?.track ?? null);
    const elapsed = last ? (at - last.at) / 1_000 : 0;
    const turnRate =
      last?.track != null && track !== null && elapsed > 0 && elapsed <= 60
        ? Math.max(
            -MAX_TURN_RATE_DEG_S,
            Math.min(MAX_TURN_RATE_DEG_S, turnBetween(last.track, track) / elapsed),
          )
        : 0;

    const shown = stateAt(receivedAt);
    last = {
      at,
      lng: flight.longitude,
      lat: flight.latitude,
      // On the ground a report carries no altitude; the aircraft is at zero.
      alt: flight.onGround
        ? 0
        : finite(flight.baroAltitude)
          ? flight.baroAltitude
          : (last?.alt ?? null),
      track,
      speed: finite(flight.velocity) && flight.velocity > 0 ? flight.velocity : 0,
      climb:
        !flight.onGround && finite(flight.verticalRate)
          ? flight.verticalRate
          : 0,
      turnRate: flight.onGround ? 0 : turnRate,
    };

    const next = predicted(receivedAt)!;
    if (!shown) {
      offset = null;
      return;
    }
    const [east, north] = offsetMeters(next, shown);
    const altGap =
      shown.alt !== null && next.alt !== null ? shown.alt - next.alt : 0;
    const teleported =
      Math.hypot(east, north) > TELEPORT_METERS ||
      Math.abs(altGap) > TELEPORT_ALTITUDE_METERS;
    offset = teleported
      ? null
      : {
          east,
          north,
          alt: altGap,
          track:
            shown.track !== null && next.track !== null
              ? turnBetween(next.track, shown.track)
              : 0,
          at: receivedAt,
        };
  }

  return { observe, stateAt };
}

export type FpvMotion = ReturnType<typeof createFpvMotion>;

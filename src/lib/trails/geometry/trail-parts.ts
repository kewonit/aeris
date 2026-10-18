import type { FlightState, FlightTrack } from "@/lib/opensky";

import type { TrailSample } from "../types";

/** A gap in reception longer than this is shown as a gap, not a line. */
export const MAX_PART_GAP_MS = 5 * 60_000;
/** Faster than any airliner, so a longer jump is a bad position. */
const MAX_PLAUSIBLE_SPEED_MPS = 450;
/** Allowance for position noise between samples close in time. */
const POSITION_NOISE_METERS = 1_500;
const METERS_PER_DEGREE = 111_320;
/** A detour this many times the direct distance is a sideways spike... */
const SPIKE_DETOUR_RATIO = 3;
/** ...once it strays this far off the direct line... */
const SPIKE_MIN_OFFSET_METERS = 60;
/** ...and the trail runs on within this angle once it is gone. */
const SPIKE_STRAIGHT_RAD = (30 * Math.PI) / 180;

/** Metres east and north from one sample to another. */
export function offsetMeters(
  from: Pick<TrailSample, "lng" | "lat">,
  to: Pick<TrailSample, "lng" | "lat">,
): [number, number] {
  let deltaLng = to.lng - from.lng;
  if (deltaLng > 180) deltaLng -= 360;
  if (deltaLng < -180) deltaLng += 360;
  const latitude = ((from.lat + to.lat) / 2) * (Math.PI / 180);
  return [
    deltaLng * METERS_PER_DEGREE * Math.cos(latitude),
    (to.lat - from.lat) * METERS_PER_DEGREE,
  ];
}

function sampleDistanceMeters(a: TrailSample, b: TrailSample): number {
  return Math.hypot(...offsetMeters(a, b));
}

/** The unsigned angle between two directions, in radians. */
export function angleBetween(
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): number {
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
}

function isOnEarth(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/** Whether an aircraft could have flown from one sample to the next. */
export function isContinuous(
  previous: TrailSample,
  next: TrailSample,
): boolean {
  const elapsedMs = next.t - previous.t;
  if (!(elapsedMs > 0) || elapsedMs > MAX_PART_GAP_MS) {
    return false;
  }
  return (
    sampleDistanceMeters(previous, next) <=
    MAX_PLAUSIBLE_SPEED_MPS * (elapsedMs / 1000) + POSITION_NOISE_METERS
  );
}

/**
 * Whether a sample sticks out sideways from a line its neighbours agree
 * on: a long detour, well off the direct line, with the trail running
 * straight on without it. A genuine U-turn or hold leaves along a new
 * direction, so it is kept.
 */
function isSidewaysSpike(
  before: TrailSample | undefined,
  previous: TrailSample,
  sample: TrailSample,
  next: TrailSample,
): boolean {
  if (
    !before ||
    previous.afterGap ||
    !isContinuous(before, previous) ||
    !isContinuous(previous, next)
  ) {
    return false;
  }

  const arrival = offsetMeters(before, previous);
  const direct = offsetMeters(previous, next);
  const directMeters = Math.hypot(...direct);
  if (!(directMeters > 0) || !(Math.hypot(...arrival) > 0)) return false;
  const out = offsetMeters(previous, sample);
  const detour = Math.hypot(...out) + sampleDistanceMeters(sample, next);
  const offLine =
    Math.abs(out[0] * direct[1] - out[1] * direct[0]) / directMeters;
  return (
    detour > SPIKE_DETOUR_RATIO * directMeters &&
    offLine > SPIKE_MIN_OFFSET_METERS &&
    angleBetween(arrival, direct) < SPIKE_STRAIGHT_RAD
  );
}

/** Drops single samples that jump away and straight back. */
function dropPositionSpikes(samples: TrailSample[]): TrailSample[] {
  if (samples.length < 3) {
    return samples;
  }

  const kept = [samples[0]];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = kept[kept.length - 1];
    const sample = samples[index];
    const next = samples[index + 1];
    // Samples either side of an unwatched stretch are never compared, and
    // one that starts a new stretch is never dropped, or the break is lost.
    if (
      !sample.afterGap &&
      !next.afterGap &&
      ((!isContinuous(previous, sample) &&
        !isContinuous(sample, next) &&
        isContinuous(previous, next)) ||
        isSidewaysSpike(kept[kept.length - 2], previous, sample, next))
    ) {
      continue;
    }
    kept.push(sample);
  }
  kept.push(samples[samples.length - 1]);
  return kept;
}

/** Splits time-ordered samples into the runs a line may be drawn through. */
export function splitIntoParts(samples: TrailSample[]): TrailSample[][] {
  const parts: TrailSample[][] = [];
  let part: TrailSample[] = [];

  for (const sample of dropPositionSpikes(samples)) {
    const last = part[part.length - 1];
    if (last && (sample.afterGap || !isContinuous(last, sample))) {
      parts.push(part);
      part = [];
    }
    part.push(sample);
  }

  if (part.length > 0) {
    parts.push(part);
  }
  return parts;
}

/**
 * Joins fetched history and live samples by time: history up to the first
 * live sample, then the live samples, with history filling any stretch the
 * live samples missed. Joining by position instead folds the trail back on
 * itself wherever the two overlap.
 */
export function mergeHistoryAndLive(
  history: TrailSample[],
  live: TrailSample[],
): TrailSample[] {
  if (live.length === 0) return history;
  if (history.length === 0) return live;

  const older = history.filter((sample) => sample.t < live[0].t);
  const merged = blendHistoryHeights(older, null, live[0]);
  let next = older.length;
  for (const [index, sample] of live.entries()) {
    if (!sample.afterGap) {
      merged.push(sample);
      continue;
    }
    // History before the first live sample already covers a gap there.
    if (index === 0) {
      merged.push(merged.length > 0 ? { ...sample, afterGap: false } : sample);
      continue;
    }
    while (next < history.length && history[next].t <= live[index - 1].t) {
      next += 1;
    }
    const from = next;
    while (next < history.length && history[next].t < sample.t) next += 1;
    if (next > from) {
      merged.push(
        ...blendHistoryHeights(
          history.slice(from, next),
          live[index - 1],
          sample,
        ),
        { ...sample, afterGap: false },
      );
    } else {
      merged.push(sample);
    }
  }
  return merged;
}

/** History heights ease onto the live height they meet over this long. */
const HANDOVER_BLEND_MS = 2 * 60_000;

/**
 * Eases a stretch of history onto the live samples either side of it, so
 * the trail meets them at their height instead of stepping there. History
 * and live reports can disagree by hundreds of feet, which drawn heights
 * stretch into a cliff; positions already agree to within a sample.
 */
function blendHistoryHeights(
  stretch: TrailSample[],
  before: TrailSample | null,
  after: TrailSample | null,
): TrailSample[] {
  if (stretch.length === 0) return [];
  const first = stretch[0];
  const last = stretch[stretch.length - 1];
  const gapTo = (history: TrailSample, live: TrailSample | null) =>
    live &&
    live.alt !== null &&
    history.alt !== null &&
    !live.onGround &&
    !history.onGround
      ? live.alt - history.alt
      : 0;
  const startGap = gapTo(first, before);
  const endGap = gapTo(last, after);
  if (startGap === 0 && endGap === 0) return [...stretch];

  // Between two live samples a short stretch shares itself between the two
  // ramps, so each end still lands exactly on its live height.
  const span = last.t - first.t;
  const window =
    startGap !== 0 && endGap !== 0
      ? Math.min(HANDOVER_BLEND_MS, span)
      : HANDOVER_BLEND_MS;
  return stretch.map((sample) => {
    if (sample.alt === null || sample.onGround) return sample;
    const offset =
      window > 0
        ? startGap * Math.max(0, 1 - (sample.t - first.t) / window) +
          endGap * Math.max(0, 1 - (last.t - sample.t) / window)
        : (startGap + endGap) / 2;
    return { ...sample, alt: Math.max(0, sample.alt + offset) };
  });
}

/** OpenSky's track endpoint rounds altitude down to the thousand feet. */
const ROUNDED_ALTITUDE_STEP_METERS = 304.8;
/** Fewer readings than this could be whole thousands by chance. */
const MIN_ROUNDED_READINGS = 5;

/**
 * Restores a smooth height profile to a track whose altitudes were rounded
 * down to whole thousands of feet, which would otherwise draw as stairs.
 * Between two runs of equal readings the aircraft crossed the higher run's
 * level, so that level is pinned midway between them and heights are
 * interpolated between such crossings; the ends sit mid-band. Tracks with
 * finer heights, and samples on the ground, are left as they are.
 */
export function smoothQuantizedAltitudes(samples: TrailSample[]): TrailSample[] {
  const airborne = samples.filter(
    (sample) => !sample.onGround && sample.alt !== null && sample.alt > 0,
  );
  const step = ROUNDED_ALTITUDE_STEP_METERS;
  const rounded =
    airborne.length >= MIN_ROUNDED_READINGS &&
    airborne.every((sample) => {
      const steps = sample.alt! / step;
      return Math.abs(steps - Math.round(steps)) * step < 1;
    });
  if (!rounded) return samples;

  const runs: { level: number; first: number; last: number }[] = [];
  for (const sample of airborne) {
    const run = runs[runs.length - 1];
    if (run && Math.abs(run.level - sample.alt!) < 1) run.last = sample.t;
    else runs.push({ level: sample.alt!, first: sample.t, last: sample.t });
  }
  const pins = [{ t: runs[0].first, alt: runs[0].level + step / 2 }];
  for (let index = 1; index < runs.length; index += 1) {
    pins.push({
      t: (runs[index - 1].last + runs[index].first) / 2,
      alt: Math.max(runs[index - 1].level, runs[index].level),
    });
  }
  const lastRun = runs[runs.length - 1];
  pins.push({ t: lastRun.last, alt: lastRun.level + step / 2 });

  let pin = 0;
  return samples.map((sample) => {
    if (sample.onGround || sample.alt === null || sample.alt <= 0) return sample;
    while (pin < pins.length - 2 && pins[pin + 1].t <= sample.t) pin += 1;
    const from = pins[pin];
    const to = pins[pin + 1];
    const share = to.t > from.t ? (sample.t - from.t) / (to.t - from.t) : 1;
    return {
      ...sample,
      alt: from.alt + (to.alt - from.alt) * Math.min(1, Math.max(0, share)),
    };
  });
}

/** Converts a provider track, whose times are Unix seconds, to samples. */
export function trackToSamples(track: FlightTrack): TrailSample[] {
  const samples: TrailSample[] = [];

  for (const waypoint of track.path) {
    const t = waypoint.time * 1000;
    if (
      waypoint.longitude == null ||
      waypoint.latitude == null ||
      !isOnEarth(waypoint.longitude, waypoint.latitude) ||
      !Number.isFinite(t)
    ) {
      continue;
    }

    samples.push({
      t,
      lng: waypoint.longitude,
      lat: waypoint.latitude,
      alt: waypoint.onGround
        ? 0
        : waypoint.baroAltitude != null &&
            Number.isFinite(waypoint.baroAltitude)
          ? waypoint.baroAltitude
          : null,
      onGround: waypoint.onGround,
    });
  }

  // Of two samples at the same moment, keep the one that knows its height.
  samples.sort(
    (left, right) =>
      left.t - right.t || Number(left.alt == null) - Number(right.alt == null),
  );
  return smoothQuantizedAltitudes(
    samples.filter(
      (sample, index) => index === 0 || sample.t !== samples[index - 1].t,
    ),
  );
}

/**
 * The flight's own observation time. Providers stamp this with their clock,
 * which can differ from the local one by minutes, so the local clock is
 * never mixed in.
 */
function observationTime(flight: FlightState): number | null {
  const observed = flight.provenance?.observationTime;
  if (observed != null && Number.isFinite(observed)) {
    return observed;
  }
  const responded = flight.provenance?.responseTime;
  return responded != null && Number.isFinite(responded) ? responded : null;
}

export function sampleFromFlight(flight: FlightState): TrailSample | null {
  const t = observationTime(flight);
  if (
    t == null ||
    flight.longitude == null ||
    flight.latitude == null ||
    !isOnEarth(flight.longitude, flight.latitude)
  ) {
    return null;
  }

  return {
    t,
    lng: flight.longitude,
    lat: flight.latitude,
    alt: flight.onGround
      ? 0
      : flight.baroAltitude != null && Number.isFinite(flight.baroAltitude)
        ? flight.baroAltitude
        : null,
    onGround: flight.onGround,
  };
}

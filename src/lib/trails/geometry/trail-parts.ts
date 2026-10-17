import type { FlightState, FlightTrack } from "@/lib/opensky";

import type { TrailSample } from "../types";

/** A gap in reception longer than this is shown as a gap, not a line. */
export const MAX_PART_GAP_MS = 5 * 60_000;
/** Faster than any airliner, so a longer jump is a bad position. */
const MAX_PLAUSIBLE_SPEED_MPS = 450;
/** Allowance for position noise between samples close in time. */
const POSITION_NOISE_METERS = 1_500;
const METERS_PER_DEGREE = 111_320;

function sampleDistanceMeters(a: TrailSample, b: TrailSample): number {
  let deltaLng = b.lng - a.lng;
  if (deltaLng > 180) deltaLng -= 360;
  if (deltaLng < -180) deltaLng += 360;
  const latitude = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot(
    deltaLng * METERS_PER_DEGREE * Math.cos(latitude),
    (b.lat - a.lat) * METERS_PER_DEGREE,
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
    if (
      !isContinuous(previous, sample) &&
      !isContinuous(sample, next) &&
      isContinuous(previous, next)
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
    if (last && !isContinuous(last, sample)) {
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
 * live sample, then the live samples. Joining by position instead folds the
 * trail back on itself wherever the two overlap.
 */
export function mergeHistoryAndLive(
  history: TrailSample[],
  live: TrailSample[],
): TrailSample[] {
  if (live.length === 0) return history;
  if (history.length === 0) return live;

  const firstLive = live[0].t;
  const older = history.filter((sample) => sample.t < firstLive);
  return older.length > 0 ? [...older, ...live] : live;
}

/** Converts a provider track, whose times are Unix seconds, to samples. */
export function trackToSamples(track: FlightTrack): TrailSample[] {
  const samples: TrailSample[] = [];

  for (const waypoint of track.path) {
    const t = waypoint.time * 1000;
    if (
      waypoint.longitude == null ||
      waypoint.latitude == null ||
      !Number.isFinite(waypoint.longitude) ||
      !Number.isFinite(waypoint.latitude) ||
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

  samples.sort((left, right) => left.t - right.t);
  return samples.filter(
    (sample, index) => index === 0 || sample.t !== samples[index - 1].t,
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
    !Number.isFinite(flight.longitude) ||
    !Number.isFinite(flight.latitude)
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

import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import type { Snapshot } from "./flight-layer-constants";
import { TELEPORT_THRESHOLD } from "./flight-layer-constants";
import {
  lerpAngle,
  horizontalDistanceFromLngLat,
  horizontalDistanceMeters,
} from "./flight-math";

const MIN_DISPLAY_TRACK_DISTANCE_METERS = 15;

function normalizeBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

function bearingFromLngLat(
  previousPosition: { lng: number; lat: number },
  currentPosition: { lng: number; lat: number },
): number | null {
  const dx = currentPosition.lng - previousPosition.lng;
  const dy = currentPosition.lat - previousPosition.lat;
  const distanceMeters = horizontalDistanceFromLngLat(
    previousPosition.lng,
    previousPosition.lat,
    currentPosition.lng,
    currentPosition.lat,
  );

  if (distanceMeters < MIN_DISPLAY_TRACK_DISTANCE_METERS) {
    return null;
  }

  return normalizeBearing((Math.atan2(dx, dy) * 180) / Math.PI);
}

export function resolveDisplayTrack(input: {
  reportedTrack?: number | null;
  previousPosition?: { lng: number; lat: number } | null;
  currentPosition?: { lng: number; lat: number } | null;
}): number {
  const reportedTrack = Number.isFinite(input.reportedTrack)
    ? normalizeBearing(input.reportedTrack!)
    : null;

  const motionTrack =
    input.previousPosition && input.currentPosition
      ? bearingFromLngLat(input.previousPosition, input.currentPosition)
      : null;

  if (motionTrack == null) {
    return reportedTrack ?? 0;
  }

  if (reportedTrack == null) {
    return motionTrack;
  }

  return motionTrack;
}

// ── Pitch Calculation ──────────────────────────────────────────────────

export function computePitchByIcao(
  interpolated: FlightState[],
  trailByIcao: Map<string, TrailEntry>,
  currSnapshots: Map<string, Snapshot>,
  prevSnapshots: Map<string, Snapshot>,
  out?: Map<string, number>,
): Map<string, number> {
  const pitchByIcao = out ?? new Map<string, number>();
  pitchByIcao.clear();

  for (const f of interpolated) {
    const curr = currSnapshots.get(f.icao24);
    const prev = prevSnapshots.get(f.icao24);

    const trendTrail = trailByIcao.get(f.icao24);
    const trendPitch =
      trendTrail && trendTrail.path.length >= 2
        ? (() => {
            const end = trendTrail.path.length - 1;
            const start = Math.max(0, end - 7);
            const startAlt =
              trendTrail.altitudes[start] ??
              trendTrail.altitudes[end] ??
              f.baroAltitude ??
              0;
            const endAlt =
              trendTrail.altitudes[end] ?? f.baroAltitude ?? startAlt;
            const [sLng, sLat] = trendTrail.path[start];
            const [eLng, eLat] = trendTrail.path[end];
            const hMeters = horizontalDistanceFromLngLat(
              sLng,
              sLat,
              eLng,
              eLat,
            );
            if (hMeters < 1) return 0;
            return (-Math.atan2(endAlt - startAlt, hMeters) * 180) / Math.PI;
          })()
        : 0;

    const risePitch =
      curr && prev
        ? (() => {
            const hMeters = horizontalDistanceMeters(prev, curr);
            if (hMeters < 1) return 0;
            const deltaAltitudeMeters = curr.alt - prev.alt;
            return (-Math.atan2(deltaAltitudeMeters, hMeters) * 180) / Math.PI;
          })()
        : 0;

    const speed =
      Number.isFinite(f.velocity) && f.velocity! > 0 ? f.velocity! : 0;
    const verticalRate = Number.isFinite(f.verticalRate) ? f.verticalRate! : 0;
    const kinematicPitch =
      speed > 0 ? (-Math.atan2(verticalRate, speed) * 180) / Math.PI : 0;

    const blendedPitch =
      trendPitch * 0.5 + risePitch * 0.38 + kinematicPitch * 0.12;
    const amplifiedPitch = blendedPitch * 1.55;
    const clampedPitch = Math.max(-40, Math.min(40, amplifiedPitch));
    pitchByIcao.set(f.icao24, clampedPitch);
  }

  return pitchByIcao;
}

// ── Bank (Roll) Calculation ────────────────────────────────────────────

const MAX_BANK_DEG = 25;

/**
 * Compute a turn-coupled bank angle for each aircraft.
 * The bank follows a sine-bell curve over the animation cycle so it
 * peaks mid-turn and eases to zero at the start/end — mimicking how
 * real aircraft roll into and out of turns.
 */
export function computeBankByIcao(
  interpolated: FlightState[],
  prevSnapshots: Map<string, Snapshot>,
  currSnapshots: Map<string, Snapshot>,
  tAngle: number,
  out?: Map<string, number>,
): Map<string, number> {
  const bankByIcao = out ?? new Map<string, number>();
  bankByIcao.clear();
  for (const f of interpolated) {
    const prev = prevSnapshots.get(f.icao24);
    const curr = currSnapshots.get(f.icao24);
    if (!prev || !curr) continue;

    // Shortest-path heading delta: positive = turning right
    const headingDelta = ((curr.track - prev.track + 540) % 360) - 180;

    // Bank proportional to turn magnitude, clamped
    const bankTarget = Math.max(
      -MAX_BANK_DEG,
      Math.min(MAX_BANK_DEG, headingDelta * 0.8),
    );

    // Sine bell curve: 0 → 1 → 0 over the animation cycle
    const bankEase = Math.sin(tAngle * Math.PI);
    bankByIcao.set(f.icao24, bankTarget * bankEase);
  }
  return bankByIcao;
}

// ── Flight Interpolation ───────────────────────────────────────────────

export function computeInterpolatedFlights(
  currentFlights: FlightState[],
  prevSnapshots: Map<string, Snapshot>,
  currSnapshots: Map<string, Snapshot>,
  tPos: number,
  tAngle: number,
  rawT: number,
  animDuration: number,
): FlightState[] {
  return currentFlights.map((f) => {
    if (f.longitude == null || f.latitude == null) return f;

    const curr = currSnapshots.get(f.icao24);
    if (!curr) return f;

    const prev = prevSnapshots.get(f.icao24);
    if (!prev) {
      return {
        ...f,
        longitude: curr.lng,
        latitude: curr.lat,
        baroAltitude: curr.alt,
        trueTrack: resolveDisplayTrack({
          reportedTrack: Number.isFinite(f.trueTrack)
            ? f.trueTrack!
            : curr.track,
        }),
      };
    }

    const dx = curr.lng - prev.lng;
    const dy = curr.lat - prev.lat;
    if (dx * dx + dy * dy > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
      return f;
    }

    if (rawT <= 1) {
      const blendedTrack = lerpAngle(prev.track, curr.track, tAngle);
      return {
        ...f,
        longitude: prev.lng + dx * tPos,
        latitude: prev.lat + dy * tPos,
        baroAltitude: prev.alt + (curr.alt - prev.alt) * tPos,
        trueTrack: resolveDisplayTrack({
          reportedTrack: blendedTrack,
          previousPosition: { lng: prev.lng, lat: prev.lat },
          currentPosition: { lng: curr.lng, lat: curr.lat },
        }),
      };
    }

    const heading = (curr.track * Math.PI) / 180;
    const speed =
      Number.isFinite(f.velocity) && f.velocity! > 0 ? f.velocity! : 200;
    const extraSec = ((rawT - 1) * animDuration) / 1000;
    const extraDeg = Math.min((speed * extraSec) / 111_320, 0.03);
    const moveDx = Math.sin(heading) * extraDeg;
    const moveDy = Math.cos(heading) * extraDeg;
    // Continue climb/descent using vertical rate, capped at ±500m
    const vr = Number.isFinite(f.verticalRate) ? f.verticalRate! : 0;
    const extraAlt = Math.max(-500, Math.min(500, vr * extraSec));
    const safeAlt = Number.isFinite(curr.alt) ? curr.alt : 0;
    return {
      ...f,
      longitude: curr.lng + moveDx,
      latitude: curr.lat + moveDy,
      baroAltitude: safeAlt + extraAlt,
      trueTrack: resolveDisplayTrack({
        reportedTrack: curr.track,
        previousPosition: { lng: prev.lng, lat: prev.lat },
        currentPosition: { lng: curr.lng, lat: curr.lat },
      }),
    };
  });
}

/**
 * In-place position update for an existing interpolated array.
 *
 * Called on animation frames between data polls. Instead of creating new
 * FlightState objects with `{...f}`, this mutates the existing objects'
 * position fields directly. Combined with a stable array reference this
 * eliminates ~18K object allocations/sec and ~360K property copies/sec.
 *
 * `rawFlights` must be the SAME array that was used to create `out` via
 * `computeInterpolatedFlights` (i.e. `flightsRef.current` hasn't changed).
 * Elements where `out[i] === rawFlights[i]` are raw references (no
 * interpolation was needed) and are left untouched.
 */
export function updateInterpolatedInPlace(
  out: FlightState[],
  rawFlights: FlightState[],
  prevSnapshots: Map<string, Snapshot>,
  currSnapshots: Map<string, Snapshot>,
  tPos: number,
  tAngle: number,
  rawT: number,
  animDuration: number,
): void {
  for (let i = 0; i < out.length; i++) {
    const o = out[i];
    const f = rawFlights[i];
    if (!o || !f) continue;

    // Skip raw references — these flights had no position or snapshot,
    // so computeInterpolatedFlights returned the raw object directly.
    // Mutating them would corrupt the source data.
    if (o === f) continue;

    const curr = currSnapshots.get(f.icao24);
    if (!curr) continue;

    const prev = prevSnapshots.get(f.icao24);
    if (!prev) {
      o.longitude = curr.lng;
      o.latitude = curr.lat;
      o.baroAltitude = curr.alt;
      o.trueTrack = resolveDisplayTrack({
        reportedTrack: Number.isFinite(f.trueTrack) ? f.trueTrack! : curr.track,
      });
      continue;
    }

    const dx = curr.lng - prev.lng;
    const dy = curr.lat - prev.lat;
    if (dx * dx + dy * dy > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) continue;

    if (rawT <= 1) {
      o.longitude = prev.lng + dx * tPos;
      o.latitude = prev.lat + dy * tPos;
      o.baroAltitude = prev.alt + (curr.alt - prev.alt) * tPos;
      o.trueTrack = resolveDisplayTrack({
        reportedTrack: lerpAngle(prev.track, curr.track, tAngle),
        previousPosition: { lng: prev.lng, lat: prev.lat },
        currentPosition: { lng: curr.lng, lat: curr.lat },
      });
    } else {
      const heading = (curr.track * Math.PI) / 180;
      const speed =
        Number.isFinite(f.velocity) && f.velocity! > 0 ? f.velocity! : 200;
      const extraSec = ((rawT - 1) * animDuration) / 1000;
      const extraDeg = Math.min((speed * extraSec) / 111_320, 0.03);
      const moveDx = Math.sin(heading) * extraDeg;
      const moveDy = Math.cos(heading) * extraDeg;
      const vr = Number.isFinite(f.verticalRate) ? f.verticalRate! : 0;
      const extraAlt = Math.max(-500, Math.min(500, vr * extraSec));
      const safeAlt = Number.isFinite(curr.alt) ? curr.alt : 0;
      o.longitude = curr.lng + moveDx;
      o.latitude = curr.lat + moveDy;
      o.baroAltitude = safeAlt + extraAlt;
      o.trueTrack = resolveDisplayTrack({
        reportedTrack: curr.track,
        previousPosition: { lng: prev.lng, lat: prev.lat },
        currentPosition: { lng: curr.lng, lat: curr.lat },
      });
    }
  }
}

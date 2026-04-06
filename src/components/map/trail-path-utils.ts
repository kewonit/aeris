/**
 * Trail path utility functions — smoothing, trimming, and fallback generation.
 *
 * Extracted from trail-base-path.ts to keep each module under ~300 lines.
 */

import type { FlightState } from "@/lib/opensky";
import type { ElevatedPoint } from "./flight-layer-constants";
import {
  STARTUP_TRAIL_POLLS,
  STARTUP_TRAIL_STEP_SEC,
  TRAIL_SMOOTHING_ITERATIONS,
} from "./flight-layer-constants";

// ── Startup Trail ──────────────────────────────────────────────────────

export function buildStartupFallbackTrail(f: FlightState): [number, number][] {
  if (f.longitude == null || f.latitude == null) return [];

  if (f.trueTrack == null || !Number.isFinite(f.trueTrack)) return [];
  if (f.velocity == null || !Number.isFinite(f.velocity) || f.velocity <= 0)
    return [];
  const heading = (f.trueTrack * Math.PI) / 180;
  const speed = f.velocity;
  const degPerSecond = speed / 111_320;

  const path: [number, number][] = [];
  for (let i = STARTUP_TRAIL_POLLS; i >= 1; i--) {
    const distDeg = Math.min(degPerSecond * STARTUP_TRAIL_STEP_SEC * i, 0.08);
    path.push([
      f.longitude - Math.sin(heading) * distDeg,
      f.latitude - Math.cos(heading) * distDeg,
    ]);
  }
  path.push([f.longitude, f.latitude]);
  return path;
}

// ── Path Trimming ──────────────────────────────────────────────────────

export function trimAfterLargeJump(
  path: [number, number][],
  altitudes: Array<number | null>,
  maxJumpDeg: number,
): { path: [number, number][]; altitudes: Array<number | null> } {
  if (path.length < 2) return { path, altitudes };

  const maxJumpSq = maxJumpDeg * maxJumpDeg;
  let start = 0;
  for (let i = path.length - 2; i >= 0; i--) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx * dx + dy * dy > maxJumpSq) {
      start = i + 1;
      break;
    }
  }

  if (start > 0) {
    start = Math.min(start, path.length - 2);
    return {
      path: path.slice(start),
      altitudes: altitudes.slice(start),
    };
  }

  return { path, altitudes };
}

// ── Elevated Path Smoothing ────────────────────────────────────────────

export function smoothElevatedPath(
  points: ElevatedPoint[],
  iterations: number = TRAIL_SMOOTHING_ITERATIONS,
): ElevatedPoint[] {
  if (points.length < 3 || iterations <= 0) return points;

  const effectiveIters =
    points.length > 4000
      ? 0
      : points.length > 2000
        ? Math.min(iterations, 1)
        : points.length > 500
          ? Math.min(iterations, 2)
          : iterations;

  let current = points;
  for (let iter = 0; iter < effectiveIters; iter++) {
    if (current.length < 3 || current.length > 6000) break;

    const next: ElevatedPoint[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      next.push([
        a[0] * 0.75 + b[0] * 0.25,
        a[1] * 0.75 + b[1] * 0.25,
        a[2] * 0.75 + b[2] * 0.25,
      ]);
      next.push([
        a[0] * 0.25 + b[0] * 0.75,
        a[1] * 0.25 + b[1] * 0.75,
        a[2] * 0.25 + b[2] * 0.75,
      ]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }

  // Absolute output cap — prevents downstream per-point processing
  // (color mapping, altitude effects) from becoming a bottleneck.
  const MAX_SMOOTH_OUTPUT = 6000;
  if (current.length > MAX_SMOOTH_OUTPUT) {
    const stride = (current.length - 1) / (MAX_SMOOTH_OUTPUT - 1);
    const capped: ElevatedPoint[] = [];
    for (let i = 0; i < MAX_SMOOTH_OUTPUT - 1; i++) {
      capped.push(current[Math.round(i * stride)]);
    }
    capped.push(current[current.length - 1]);
    current = capped;
  }

  return current;
}

// ── Altitude Smoothing ─────────────────────────────────────────────────

/**
 * Multi-pass altitude smoothing with outlier pre-filtering and a wider
 * kernel to prevent near-vertical "wall" artifacts on climb/descent trails.
 */
export function smoothAnimationAltitudes(
  values: number[],
  passes: number = 3,
): number[] {
  if (values.length < 2 || passes <= 0) return values;

  // For 2 points, apply a gentle blend toward the mean to reduce the
  // visual snap when the 3rd point arrives and full smoothing kicks in.
  if (values.length === 2) {
    const mean = (values[0] + values[1]) * 0.5;
    return [values[0] * 0.85 + mean * 0.15, values[1] * 0.85 + mean * 0.15];
  }

  // Pre-pass: reject altitude spikes (>800m from local median).
  const SPIKE_THRESHOLD = 800;
  let result = [...values];
  if (result.length >= 5) {
    for (let i = 2; i < result.length - 2; i++) {
      const window = [
        result[i - 2],
        result[i - 1],
        result[i],
        result[i + 1],
        result[i + 2],
      ];
      const sorted = [...window].sort((a, b) => a - b);
      const med = sorted[2];
      if (Math.abs(result[i] - med) > SPIKE_THRESHOLD) {
        result[i] = (result[i - 1] + result[i + 1]) / 2;
      }
    }
  }

  // Main smoothing passes
  for (let p = 0; p < passes; p++) {
    const next = [...result];
    for (let i = 1; i < result.length - 1; i++) {
      next[i] = result[i - 1] * 0.3 + result[i] * 0.4 + result[i + 1] * 0.3;
    }
    result = next;
  }
  return result;
}

// ── Trail Ahead Trimming ───────────────────────────────────────────────

export function trimPathAheadOfAircraft(
  points: ElevatedPoint[],
  aircraft: ElevatedPoint,
  aircraftTrackDeg?: number,
): ElevatedPoint[] {
  if (points.length < 2) return [aircraft];

  const px = aircraft[0];
  const py = aircraft[1];

  let bestIndex = points.length - 2;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestSegT = 0; // fractional position along the best segment

  // Search the last portion of the trail for the closest segment to the
  // aircraft.  Wider window for fullHistory trails (2000+ pts) that have
  // been splined and may not exactly match the live position.
  const searchStart = Math.max(
    0,
    points.length -
      Math.max(12, Math.min(100, Math.ceil(points.length * 0.25))),
  );

  for (let i = searchStart; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denom = dx * dx + dy * dy;
    const t =
      denom > 1e-12
        ? Math.max(
            0,
            Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / denom),
          )
        : 0;
    const qx = a[0] + dx * t;
    const qy = a[1] + dy * t;
    const distSq = (px - qx) * (px - qx) + (py - qy) * (py - qy);

    if (distSq < bestDistanceSq) {
      bestDistanceSq = distSq;
      bestIndex = i;
      bestSegT = t;
    }
  }

  // Trim at the fractional clip point on the nearest segment instead of
  // at the segment start — eliminates a visible positional jump.
  const trimmed = points.slice(0, bestIndex + 1);
  const segA = points[bestIndex];
  const segB = points[bestIndex + 1];
  if (bestSegT > 0.01) {
    // Insert the interpolated clip point on the segment
    const clipPt: ElevatedPoint = [
      segA[0] + (segB[0] - segA[0]) * bestSegT,
      segA[1] + (segB[1] - segA[1]) * bestSegT,
      segA[2] + (segB[2] - segA[2]) * bestSegT,
    ];
    trimmed.push(clipPt);
  }

  // ── Cubic Bézier connection ──────────────────────────────────────
  // Uses both the trail's local heading (tangent at clip point) and the
  // aircraft's heading to create a smooth curve that transitions
  // naturally from the trail direction into the aircraft's flight path.
  const clipPt = trimmed[trimmed.length - 1];
  if (clipPt && trimmed.length >= 2) {
    const prevPt = trimmed[trimmed.length - 2];
    // Trail tangent direction at the clip point
    const tdx = clipPt[0] - prevPt[0];
    const tdy = clipPt[1] - prevPt[1];
    const tLen = Math.sqrt(tdx * tdx + tdy * tdy);

    const dx = px - clipPt[0];
    const dy = py - clipPt[1];
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1e-7) {
      // Trail tangent unit vector
      const tux = tLen > 1e-10 ? tdx / tLen : 0;
      const tuy = tLen > 1e-10 ? tdy / tLen : 0;

      // How aligned is trail heading → aircraft direction? [-1, 1]
      const dot = tLen > 1e-10 ? (tdx * dx + tdy * dy) / (tLen * dist) : 0;

      // CP1 lever: extends clip point along the trail tangent.
      // Scaled by alignment — avoids loops when trail points away.
      const lever1 =
        Math.max(0, dot) * Math.min(0.45, 0.5 * Math.min(1, dist / 0.005));

      // CP1: extends from clip point along trail tangent
      const cp1x = clipPt[0] + tux * dist * lever1;
      const cp1y = clipPt[1] + tuy * dist * lever1;
      const cp1z = clipPt[2] + (aircraft[2] - clipPt[2]) * 0.33;

      // CP2: extends from aircraft BACKWARDS along its heading.
      // Uses the aircraft track if available, otherwise falls back
      // to the displacement vector from clip point to aircraft.
      let ahx: number, ahy: number;
      if (aircraftTrackDeg != null && Number.isFinite(aircraftTrackDeg)) {
        const rad = (aircraftTrackDeg * Math.PI) / 180;
        ahx = Math.sin(rad);
        ahy = Math.cos(rad);
      } else {
        // Fallback: use direction from clip to aircraft
        ahx = dist > 1e-10 ? dx / dist : tux;
        ahy = dist > 1e-10 ? dy / dist : tuy;
      }

      // CP2 lever: always positive — aircraft control point pulls
      // backwards along the flight direction.
      const lever2 = Math.min(0.45, 0.5 * Math.min(1, dist / 0.005));
      const cp2x = px - ahx * dist * lever2;
      const cp2y = py - ahy * dist * lever2;
      const cp2z = clipPt[2] + (aircraft[2] - clipPt[2]) * 0.67;

      // Insert 6 cubic Bézier points for a smooth connection
      const ARC_STEPS = 6;
      for (let j = 1; j <= ARC_STEPS; j++) {
        const t = j / (ARC_STEPS + 1);
        const u = 1 - t;
        const u2 = u * u;
        const t2 = t * t;
        // Cubic Bézier: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
        const b0 = u2 * u;
        const b1 = 3 * u2 * t;
        const b2 = 3 * u * t2;
        const b3 = t2 * t;
        trimmed.push([
          b0 * clipPt[0] + b1 * cp1x + b2 * cp2x + b3 * px,
          b0 * clipPt[1] + b1 * cp1y + b2 * cp2y + b3 * py,
          Number.isFinite(clipPt[2]) && Number.isFinite(aircraft[2])
            ? b0 * clipPt[2] + b1 * cp1z + b2 * cp2z + b3 * aircraft[2]
            : aircraft[2],
        ]);
      }
    }
  }

  // Stop the trail slightly short of the aircraft center so it visually
  // connects at the tail rather than passing through the icon body.
  // Use 75% of the remaining distance from the last Bézier point to the
  // aircraft — this is proportional to the arc length, so it works at
  // any zoom level without needing pixel-to-degree conversion.
  if (trimmed.length >= 2) {
    const lastPt = trimmed[trimmed.length - 1];
    const tailFrac = 0.75;
    trimmed.push([
      lastPt[0] + (px - lastPt[0]) * tailFrac,
      lastPt[1] + (py - lastPt[1]) * tailFrac,
      lastPt[2] + (aircraft[2] - lastPt[2]) * tailFrac,
    ]);
  } else {
    trimmed.push([px, py, aircraft[2]]);
  }

  return trimmed;
}

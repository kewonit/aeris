import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { snapLngToReference, unwrapLngPath } from "@/lib/geo";
import {
  removeSpikePoints,
  removeDistanceOutliers,
  roundSharpCorners3D,
  catmullRomSpline3D,
  removePathLoops,
} from "@/lib/trail-smoothing";
import type { ElevatedPoint, Snapshot } from "./flight-layer-constants";
import {
  STARTUP_TRAIL_POLLS,
  STARTUP_TRAIL_STEP_SEC,
  TELEPORT_THRESHOLD,
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

// ── Interpolation Math ─────────────────────────────────────────────────

export function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

export function trackFromDelta(
  dx: number,
  dy: number,
  fallback: number,
): number {
  if (dx * dx + dy * dy < 1e-10) return fallback;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

// ── Distance Helpers ───────────────────────────────────────────────────

export function horizontalDistanceFromLngLat(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const avgLatRad = ((aLat + bLat) * 0.5 * Math.PI) / 180;
  const metersPerDegLon = 111_320 * Math.max(0.2, Math.cos(avgLatRad));
  const dx = (bLng - aLng) * metersPerDegLon;
  const dy = (bLat - aLat) * 111_320;
  return Math.hypot(dx, dy);
}

export function horizontalDistanceMeters(a: Snapshot, b: Snapshot): number {
  return horizontalDistanceFromLngLat(a.lng, a.lat, b.lng, b.lat);
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
): ElevatedPoint[] {
  if (points.length < 2) return [aircraft];

  const px = aircraft[0];
  const py = aircraft[1];

  let bestIndex = points.length - 2;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  // Search only the last 15% (min 12) to prevent clip-point jump-backs.
  const searchStart = Math.max(
    0,
    points.length - Math.max(12, Math.ceil(points.length * 0.15)),
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
    }
  }

  const trimmed = points.slice(0, bestIndex + 1);

  // Smooth transition: insert a quadratic Bézier arc between the trail's
  // clip point and the aircraft. The control-point lever is scaled by
  // heading alignment (dot product) so turning aircraft never create loops.
  const lastPt = trimmed[trimmed.length - 1];
  if (lastPt && trimmed.length >= 2) {
    const prevPt = trimmed[trimmed.length - 2];
    const hdx = lastPt[0] - prevPt[0];
    const hdy = lastPt[1] - prevPt[1];
    const hLen = Math.sqrt(hdx * hdx + hdy * hdy);
    const dx = px - lastPt[0];
    const dy = py - lastPt[1];
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1e-7) {
      // How aligned is trail heading → aircraft direction? [-1, 1]
      const dot = hLen > 1e-10 ? (hdx * dx + hdy * dy) / (hLen * dist) : 0;
      // Scale lever by alignment: 0 when perpendicular/behind (no loop),
      // up to 0.4 when heading straight at the aircraft (smooth arc).
      const lever =
        Math.max(0, dot) * Math.min(0.3, 0.4 * Math.min(1, dist / 0.01));
      const ux = hLen > 1e-10 ? hdx / hLen : 0;
      const uy = hLen > 1e-10 ? hdy / hLen : 0;
      const cx = lastPt[0] + ux * dist * lever;
      const cy = lastPt[1] + uy * dist * lever;

      // Insert 3 Bézier arc points between trail end and aircraft
      for (let j = 1; j <= 3; j++) {
        const t = j / 4;
        const b0 = (1 - t) * (1 - t);
        const b1 = 2 * (1 - t) * t;
        const b2 = t * t;
        trimmed.push([
          b0 * lastPt[0] + b1 * cx + b2 * px,
          b0 * lastPt[1] + b1 * cy + b2 * py,
          lastPt[2] + (aircraft[2] - lastPt[2]) * t,
        ]);
      }
    }
  }

  trimmed.push([px, py, aircraft[2]]);

  return trimmed;
}

// ── Trail Base Path Cache ──────────────────────────────────────────────

/**
 * Generates a cache key for trail base path computation.
 * The base path only changes when trail data grows, trail distance changes,
 * or fullHistory mode toggles. Keyed on the last point so appends invalidate.
 */
export function trailBasePathCacheKey(
  trail: TrailEntry,
  trailDistance: number,
): string {
  const n = trail.path.length;
  const last = n > 0 ? trail.path[n - 1] : null;
  const lastAlt =
    trail.altitudes.length > 0
      ? trail.altitudes[trail.altitudes.length - 1]
      : null;
  return `${n}|${trailDistance}|${trail.fullHistory ? 1 : 0}|${last?.[0]}|${last?.[1]}|${lastAlt}`;
}

/**
 * Computes the expensive base path (smoothing + densification) for a trail.
 * This result is cacheable across animation frames — it only depends on
 * trail.path, trail.altitudes, trailDistance, and fullHistory.
 * The per-frame head attachment (trimPathAheadOfAircraft) is NOT included.
 */
export function buildTrailBasePath(
  trail: TrailEntry,
  trailDistance: number,
): ElevatedPoint[] {
  const isFullHistory = trail.fullHistory === true;
  const historyPoints = isFullHistory
    ? trail.path.length
    : Math.max(2, Math.round(trailDistance));

  let pathSlice =
    isFullHistory || trail.path.length <= historyPoints
      ? trail.path
      : trail.path.slice(trail.path.length - historyPoints);
  let altitudeSlice =
    isFullHistory || trail.altitudes.length <= historyPoints
      ? trail.altitudes
      : trail.altitudes.slice(trail.altitudes.length - historyPoints);

  if (isFullHistory) {
    const MAX_FULL_HISTORY_POINTS = 2000;
    if (pathSlice.length > MAX_FULL_HISTORY_POINTS) {
      const stride = pathSlice.length / MAX_FULL_HISTORY_POINTS;
      const nextPath: [number, number][] = [];
      const nextAlt: Array<number | null> = [];
      for (let i = 0; i < MAX_FULL_HISTORY_POINTS - 1; i++) {
        const idx = Math.floor(i * stride);
        nextPath.push(pathSlice[idx]);
        nextAlt.push(altitudeSlice[idx] ?? null);
      }
      nextPath.push(pathSlice[pathSlice.length - 1]);
      nextAlt.push(altitudeSlice[altitudeSlice.length - 1] ?? null);
      pathSlice = nextPath;
      altitudeSlice = nextAlt;
    }
  }

  if (altitudeSlice.length !== pathSlice.length) {
    const last = altitudeSlice[altitudeSlice.length - 1] ?? null;
    if (altitudeSlice.length < pathSlice.length) {
      altitudeSlice = [...altitudeSlice];
      while (altitudeSlice.length < pathSlice.length) {
        altitudeSlice.push(last);
      }
    } else {
      altitudeSlice = altitudeSlice.slice(
        altitudeSlice.length - pathSlice.length,
      );
    }
  }

  const unwrappedPath = unwrapLngPath(pathSlice);
  const maxJumpDeg = isFullHistory ? 3.0 : TELEPORT_THRESHOLD;
  const trimmed = trimAfterLargeJump(unwrappedPath, altitudeSlice, maxJumpDeg);
  pathSlice = trimmed.path;
  altitudeSlice = trimmed.altitudes;

  if (isFullHistory) {
    // The historical portion is already smooth from the Catmull-Rom
    // spline in trail-stitching.ts, but the stitched live-tail portion
    // is raw GPS.  Apply roundSharpCorners3D to catch remaining tight
    // turns (approach patterns, live-tail heading kinks) without
    // re-running the full kernel pre-smoothing or re-spline.
    const rawAltitudes = altitudeSlice.map((a) => a ?? trail.baroAltitude ?? 0);
    const altitudeMeters = smoothAnimationAltitudes(rawAltitudes, 3);
    const elevated = pathSlice.map(
      (p, i) =>
        [
          p[0],
          p[1],
          Math.max(0, altitudeMeters[i] ?? trail.baroAltitude ?? 0),
        ] as ElevatedPoint,
    );
    if (elevated.length >= 3) {
      const rounded = roundSharpCorners3D(elevated, 15);
      return removePathLoops(rounded);
    }
    return elevated;
  }

  // Active trails: remove GPS glitches (distance outliers + V-spikes),
  // smooth positions to reduce measurement noise, smooth altitudes, then
  // apply Catmull-Rom spline for consistent visual smoothness.

  // Step 1: Remove distance outliers — catches random GPS/MLAT points
  // that deviate far from the local path trend.
  const outlierResult = removeDistanceOutliers(pathSlice, altitudeSlice, 3.0);

  // Step 2: Remove V-shaped direction-reversal spikes.
  const spikeResult = removeSpikePoints(
    outlierResult.path,
    outlierResult.altitudes,
  );

  // Pre-smooth 2D positions to reduce GPS jitter before spline interpolation.
  let smoothedPath = spikeResult.path;
  if (smoothedPath.length >= 3) {
    for (let pass = 0; pass < 5; pass++) {
      const next: [number, number][] = [smoothedPath[0]];
      for (let i = 1; i < smoothedPath.length - 1; i++) {
        next.push([
          smoothedPath[i - 1][0] * 0.25 +
            smoothedPath[i][0] * 0.5 +
            smoothedPath[i + 1][0] * 0.25,
          smoothedPath[i - 1][1] * 0.25 +
            smoothedPath[i][1] * 0.5 +
            smoothedPath[i + 1][1] * 0.25,
        ]);
      }
      next.push(smoothedPath[smoothedPath.length - 1]);
      smoothedPath = next;
    }
  }

  const rawAltitudes = spikeResult.altitudes.map(
    (a) => a ?? trail.baroAltitude ?? 0,
  );
  const altitudeMeters = smoothAnimationAltitudes(rawAltitudes, 3);

  const elevated: ElevatedPoint[] = smoothedPath.map((p, i) => [
    p[0],
    p[1],
    Math.max(0, altitudeMeters[i] ?? trail.baroAltitude ?? 0),
  ]);

  if (elevated.length >= 2) {
    const rounded = roundSharpCorners3D(elevated, 15);
    const splined = catmullRomSpline3D(rounded, 5, 14);
    // Remove self-intersecting loops from spline overshoot.
    return removePathLoops(splined);
  }
  return elevated;
}

// ── Visible Trail Point Builder (extracted from component) ─────────────

/**
 * Builds the final visible trail points for rendering.
 * When cachedBasePath is provided, skips the expensive smoothing/densification
 * and only performs the cheap per-frame head attachment + final smoothing.
 */
export function buildVisibleTrailPoints(
  trail: TrailEntry,
  animFlight: FlightState | undefined,
  trailDistance: number,
  smoothingIterations: number,
  cachedBasePath?: ElevatedPoint[],
): ElevatedPoint[] {
  const denseBasePath =
    cachedBasePath ?? buildTrailBasePath(trail, trailDistance);

  // Skip Chaikin subdivision — the Catmull-Rom spline, roundSharpCorners3D,
  // and Bézier head-arc already produce smooth, dense output.  Running
  // Chaikin on top would bloat ~200 pts → ~1600 per trail per frame,
  // causing severe lag during orbit with 100+ aircraft.
  const skipChaikin = true;

  if (
    animFlight &&
    animFlight.longitude != null &&
    animFlight.latitude != null &&
    denseBasePath.length > 1
  ) {
    const refLng = denseBasePath[denseBasePath.length - 1][0];
    const snappedLng = snapLngToReference(animFlight.longitude, refLng);
    const clipped = trimPathAheadOfAircraft(denseBasePath, [
      snappedLng,
      animFlight.latitude,
      Math.max(0, animFlight.baroAltitude ?? 0),
    ]);

    const smoothed =
      skipChaikin || clipped.length < 4
        ? clipped
        : smoothElevatedPath(clipped, smoothingIterations);

    return smoothed.map((p) => [p[0], p[1], Math.max(0, p[2])]);
  }

  const smoothed =
    skipChaikin || denseBasePath.length < 4
      ? denseBasePath
      : smoothElevatedPath(denseBasePath, smoothingIterations);

  return smoothed.map((p) => [p[0], p[1], Math.max(0, p[2])]);
}

// ── Pitch Calculation (extracted from component) ───────────────────────

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

// ── Flight Interpolation (extracted from RAF loop) ─────────────────────

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
        trueTrack: Number.isFinite(f.trueTrack) ? f.trueTrack! : curr.track,
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
        trueTrack: trackFromDelta(dx, dy, blendedTrack),
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
    return {
      ...f,
      longitude: curr.lng + moveDx,
      latitude: curr.lat + moveDy,
      baroAltitude: curr.alt + extraAlt,
      trueTrack: trackFromDelta(moveDx, moveDy, curr.track),
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
      o.trueTrack = Number.isFinite(f.trueTrack) ? f.trueTrack! : curr.track;
      continue;
    }

    const dx = curr.lng - prev.lng;
    const dy = curr.lat - prev.lat;
    if (dx * dx + dy * dy > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) continue;

    if (rawT <= 1) {
      o.longitude = prev.lng + dx * tPos;
      o.latitude = prev.lat + dy * tPos;
      o.baroAltitude = prev.alt + (curr.alt - prev.alt) * tPos;
      o.trueTrack = trackFromDelta(
        dx,
        dy,
        lerpAngle(prev.track, curr.track, tAngle),
      );
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
      o.longitude = curr.lng + moveDx;
      o.latitude = curr.lat + moveDy;
      o.baroAltitude = curr.alt + extraAlt;
      o.trueTrack = trackFromDelta(moveDx, moveDy, curr.track);
    }
  }
}

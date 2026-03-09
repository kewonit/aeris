/**
 * Trail smoothing utilities for historical flight tracks.
 *
 * Active trails (from live OpenSky polls) use Chaikin subdivision and are
 * already smooth.  Historical trails (from the /tracks endpoint) have very
 * sparse waypoints (~15-minute intervals) and need spline interpolation to
 * look natural.
 *
 * This module provides:
 * - Centripetal Catmull-Rom spline interpolation (3D: lng, lat, altitude)
 * - Curvature-aware adaptive densification
 * - Altitude profile smoothing with realistic descent handling
 * - Ground-segment filtering
 */

type ElevatedPoint = [lng: number, lat: number, altitude: number];

// ---------------------------------------------------------------------------
// Centripetal Catmull-Rom spline
// ---------------------------------------------------------------------------
//
// The centripetal parameterisation (alpha = 0.5) avoids cusps and self-
// intersections that the uniform variant can produce.  It is evaluated
// per-segment using four control points P0..P3.
//
// Reference: E. Yuksel, S. Schaefer, J. Keyser – "On the parameterization
// of Catmull-Rom curves" (2011).

const CR_ALPHA = 0.5; // centripetal

function crKnot(ti: number, pi: ElevatedPoint, pj: ElevatedPoint): number {
  const dx = pj[0] - pi[0];
  const dy = pj[1] - pi[1];
  const dz = pj[2] - pi[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  // d^alpha where alpha = 0.5 → sqrt(d) → (d^2)^0.25
  return ti + Math.pow(Math.max(d2, 1e-12), CR_ALPHA * 0.5);
}

/**
 * Evaluate a single centripetal Catmull-Rom segment (P1→P2) at parameter t
 * in [0,1].  P0 and P3 are the neighbouring control points.
 */
function crSegmentPoint(
  P0: ElevatedPoint,
  P1: ElevatedPoint,
  P2: ElevatedPoint,
  P3: ElevatedPoint,
  t01: number, // normalised [0,1] along P1→P2
): ElevatedPoint {
  const t0 = 0;
  const t1 = crKnot(t0, P0, P1);
  const t2 = crKnot(t1, P1, P2);
  const t3 = crKnot(t2, P2, P3);

  // Map normalised t to the knot interval [t1, t2].
  const t = t1 + t01 * (t2 - t1);

  // Barry-Goldman algorithm.
  const out: ElevatedPoint = [0, 0, 0];
  for (let dim = 0; dim < 3; dim++) {
    const p0 = P0[dim];
    const p1 = P1[dim];
    const p2 = P2[dim];
    const p3 = P3[dim];

    const A1 = safeLerp(p0, p1, t0, t1, t);
    const A2 = safeLerp(p1, p2, t1, t2, t);
    const A3 = safeLerp(p2, p3, t2, t3, t);
    const B1 = safeLerp(A1, A2, t0, t2, t);
    const B2 = safeLerp(A2, A3, t1, t3, t);
    out[dim] = safeLerp(B1, B2, t1, t2, t);
  }
  return out;
}

/** Lerp with guard against zero-length intervals. */
function safeLerp(
  a: number,
  b: number,
  tA: number,
  tB: number,
  t: number,
): number {
  const denom = tB - tA;
  if (Math.abs(denom) < 1e-12) return (a + b) * 0.5;
  return ((tB - t) / denom) * a + ((t - tA) / denom) * b;
}

/**
 * Generate a virtual control point by reflecting the first/last segment.
 * Used to handle the endpoints of an open curve.
 */
function reflectEndpoint(
  anchor: ElevatedPoint,
  neighbour: ElevatedPoint,
): ElevatedPoint {
  return [
    2 * anchor[0] - neighbour[0],
    2 * anchor[1] - neighbour[1],
    2 * anchor[2] - neighbour[2],
  ];
}

/**
 * Determine how many interpolated points to insert in a segment based on
 * its arc length (in degrees) and heading change.
 */
function segmentDensity(
  a: ElevatedPoint,
  b: ElevatedPoint,
  prevHeading: number | null,
  minPts: number,
  maxPts: number,
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.sqrt(dx * dx + dy * dy); // degrees
  const heading = Math.atan2(dx, dy);

  let curvatureFactor = 0;
  if (prevHeading !== null) {
    let delta = heading - prevHeading;
    // Normalise to [-PI, PI]
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    curvatureFactor = Math.abs(delta) / Math.PI; // 0..1
  }

  // Longer segments and segments at turns get more points.
  const distFactor = Math.min(1, dist / 2); // saturate at 2 degrees
  const raw =
    minPts + (maxPts - minPts) * Math.max(distFactor, curvatureFactor);
  return Math.max(minPts, Math.min(maxPts, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interpolate sparse waypoints into a smooth 3D path using centripetal
 * Catmull-Rom splines.
 *
 * @param points  Ordered waypoints [lng, lat, alt]. Minimum 2 points.
 * @param minPtsPerSeg  Minimum interpolated points per segment (default 6).
 * @param maxPtsPerSeg  Maximum interpolated points per segment (default 28).
 * @returns Smoothly interpolated path including all original waypoints.
 */
export function catmullRomSpline3D(
  points: ElevatedPoint[],
  minPtsPerSeg: number = 6,
  maxPtsPerSeg: number = 28,
): ElevatedPoint[] {
  if (points.length < 2) return points.slice();

  // Two points → linear interpolation (Catmull-Rom needs ≥4 control points).
  if (points.length === 2) {
    return linearInterpolateSegment(points[0], points[1], 8);
  }

  // Three points → add virtual endpoints so we get two proper CR segments.
  if (points.length === 3) {
    const virtual0 = reflectEndpoint(points[0], points[1]);
    const virtual3 = reflectEndpoint(points[2], points[1]);
    return catmullRomSplineCore(
      [virtual0, ...points, virtual3],
      1,
      points.length,
      minPtsPerSeg,
      maxPtsPerSeg,
    );
  }

  // General case: ≥4 points. Create virtual endpoints for the first and last
  // segments so the spline passes smoothly through ALL original waypoints.
  const virtual0 = reflectEndpoint(points[0], points[1]);
  const virtualN = reflectEndpoint(
    points[points.length - 1],
    points[points.length - 2],
  );
  const extended = [virtual0, ...points, virtualN];

  return catmullRomSplineCore(
    extended,
    1,
    points.length,
    minPtsPerSeg,
    maxPtsPerSeg,
  );
}

/**
 * Internal: Interpolate segments [startIdx .. startIdx+segCount-1] within
 * the `extended` control-point array (which has virtual endpoints prepended/
 * appended).
 *
 * Uses variable tension: straight segments (low heading change) get more
 * linear interpolation to avoid S-curve wobble; turn segments get full
 * Catmull-Rom curvature for smooth arcs.
 */
function catmullRomSplineCore(
  extended: ElevatedPoint[],
  startIdx: number,
  segCount: number,
  minPts: number,
  maxPts: number,
): ElevatedPoint[] {
  const result: ElevatedPoint[] = [];
  let prevHeading: number | null = null;

  // Pre-compute headings at each waypoint for tension calculation.
  const headings: number[] = [];
  for (let i = 0; i < segCount - 1; i++) {
    const idx = startIdx + i;
    const P1 = extended[idx];
    const P2 = extended[idx + 1];
    headings.push(Math.atan2(P2[0] - P1[0], P2[1] - P1[1]));
  }

  for (let i = 0; i < segCount - 1; i++) {
    const idx = startIdx + i;
    const P0 = extended[idx - 1];
    const P1 = extended[idx];
    const P2 = extended[idx + 1];
    const P3 = extended[idx + 2];

    const nPts = segmentDensity(P1, P2, prevHeading, minPts, maxPts);

    // Compute heading change at this segment to determine tension.
    // Small heading change → high tension (more linear, avoids wobble).
    // Large heading change → low tension (full spline curvature).
    const headingBefore = i > 0 ? headings[i - 1] : headings[i];
    const headingAfter =
      i < headings.length - 1 ? headings[i + 1] : headings[i];

    let deltaIn = headings[i] - headingBefore;
    if (deltaIn > Math.PI) deltaIn -= 2 * Math.PI;
    if (deltaIn < -Math.PI) deltaIn += 2 * Math.PI;

    let deltaOut = headingAfter - headings[i];
    if (deltaOut > Math.PI) deltaOut -= 2 * Math.PI;
    if (deltaOut < -Math.PI) deltaOut += 2 * Math.PI;

    // Maximum heading change at either end of this segment.
    const maxDelta = Math.max(Math.abs(deltaIn), Math.abs(deltaOut));

    // Tension: 0 = full spline, 1 = fully linear.
    // Below 5° heading change → mostly linear (tension ~0.9).
    // Above 20° heading change → full spline (tension ~0).
    const STRAIGHT_THRESHOLD = (5 * Math.PI) / 180; // 5°
    const CURVE_THRESHOLD = (20 * Math.PI) / 180; // 20°
    const tension =
      maxDelta <= STRAIGHT_THRESHOLD
        ? 0.92
        : maxDelta >= CURVE_THRESHOLD
          ? 0.0
          : 0.92 *
            (1.0 -
              (maxDelta - STRAIGHT_THRESHOLD) /
                (CURVE_THRESHOLD - STRAIGHT_THRESHOLD));

    // Always include the segment start point.
    result.push(P1);

    for (let j = 1; j < nPts; j++) {
      const t = j / nPts;

      if (tension >= 0.98) {
        // Pure linear interpolation — avoid any spline computation.
        result.push(lerpPoint(P1, P2, t));
      } else if (tension <= 0.02) {
        // Pure Catmull-Rom spline.
        result.push(crSegmentPoint(P0, P1, P2, P3, t));
      } else {
        // Blend: linear interpolation ← tension → spline curve.
        const splineP = crSegmentPoint(P0, P1, P2, P3, t);
        const linearP = lerpPoint(P1, P2, t);
        result.push([
          linearP[0] * tension + splineP[0] * (1 - tension),
          linearP[1] * tension + splineP[1] * (1 - tension),
          linearP[2] * tension + splineP[2] * (1 - tension),
        ]);
      }
    }

    prevHeading = headings[i];
  }

  // Include the last waypoint.
  result.push(extended[startIdx + segCount - 1]);

  return result;
}

/** Linear interpolation between two elevated points. */
function lerpPoint(
  a: ElevatedPoint,
  b: ElevatedPoint,
  t: number,
): ElevatedPoint {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Simple linear interpolation for 2-point paths. */
function linearInterpolateSegment(
  a: ElevatedPoint,
  b: ElevatedPoint,
  count: number,
): ElevatedPoint[] {
  const out: ElevatedPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Altitude profile smoothing
// ---------------------------------------------------------------------------

/**
 * Smooth altitude values using 1D centripetal Catmull-Rom interpolation.
 * This replaces `smoothNumericSeries` for historical trails where the
 * altitudes are already sparse-waypoint values that need interpolation,
 * not high-frequency noise filtering.
 */
export function smoothAltitudeProfile(
  altitudes: Array<number | null>,
  defaultAlt: number,
): number[] {
  // Fill nulls with nearest-neighbour interpolation.
  const filled = fillNullAltitudes(altitudes, defaultAlt);

  if (filled.length < 4) return filled;

  // Pass 1: Gentle 5-pass box filter to remove altitude staircase artifacts.
  let current = filled;
  for (let pass = 0; pass < 5; pass++) {
    const next = [...current];
    for (let i = 1; i < current.length - 1; i++) {
      next[i] =
        current[i - 1] * 0.25 + current[i] * 0.5 + current[i + 1] * 0.25;
    }
    current = next;
  }

  // Pass 2: Rate-of-change limiter for realistic climb/descent profiles.
  // Real aircraft change altitude at ~500-2000 fpm (150-600 m/min).
  // With ~15min between waypoints, max realistic change per step is ~9000m.
  // But the smoothed profile should have much gentler per-step changes.
  // Apply a sigmoid-style rate limiter that prevents sudden altitude jumps
  // while preserving the overall profile shape.
  const smoothed = [...current];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < smoothed.length; i++) {
      const delta = smoothed[i] - smoothed[i - 1];
      const absDelta = Math.abs(delta);
      // For small changes (< 200m), leave as-is.
      // For large changes, apply soft clamping with a sigmoid.
      if (absDelta > 200) {
        const softMax = 200 + (absDelta - 200) * 0.6;
        smoothed[i] = smoothed[i - 1] + Math.sign(delta) * softMax;
      }
    }
    // Reverse pass to avoid directional bias.
    for (let i = smoothed.length - 2; i >= 0; i--) {
      const delta = smoothed[i] - smoothed[i + 1];
      const absDelta = Math.abs(delta);
      if (absDelta > 200) {
        const softMax = 200 + (absDelta - 200) * 0.6;
        smoothed[i] = smoothed[i + 1] + Math.sign(delta) * softMax;
      }
    }
  }

  // Blend with original to preserve endpoint altitudes (departure/arrival).
  smoothed[0] = current[0];
  smoothed[smoothed.length - 1] = current[current.length - 1];

  return smoothed;
}

/**
 * Fill null altitude values using nearest-neighbour interpolation.
 * Isolated nulls get the average of their neighbours; leading/trailing
 * runs get the nearest non-null value.
 */
function fillNullAltitudes(
  altitudes: Array<number | null>,
  defaultAlt: number,
): number[] {
  const out = altitudes.map((a) =>
    a !== null && Number.isFinite(a) ? a : NaN,
  );

  // Forward fill.
  let lastValid = NaN;
  for (let i = 0; i < out.length; i++) {
    if (!isNaN(out[i])) {
      lastValid = out[i];
    } else if (!isNaN(lastValid)) {
      out[i] = lastValid;
    }
  }

  // Backward fill (for leading NaNs).
  lastValid = NaN;
  for (let i = out.length - 1; i >= 0; i--) {
    if (!isNaN(out[i])) {
      lastValid = out[i];
    } else if (!isNaN(lastValid)) {
      out[i] = lastValid;
    }
  }

  // If everything is NaN, use the default.
  return out.map((v) => (isNaN(v) ? defaultAlt : v));
}

// ---------------------------------------------------------------------------
// Ground segment filtering
// ---------------------------------------------------------------------------

export type WaypointLike = {
  onGround: boolean;
  latitude: number | null;
  longitude: number | null;
  baroAltitude: number | null;
};

/**
 * Strip leading and trailing ground segments from a historical track.
 * Keeps the first/last airborne waypoint as endpoints.
 * Returns null if all waypoints are on the ground.
 */
export function filterGroundSegments<T extends WaypointLike>(
  waypoints: T[],
): T[] | null {
  let firstAirborne = -1;
  let lastAirborne = -1;

  for (let i = 0; i < waypoints.length; i++) {
    if (!waypoints[i].onGround) {
      if (firstAirborne === -1) firstAirborne = i;
      lastAirborne = i;
    }
  }

  if (firstAirborne === -1) return null; // all on ground

  return waypoints.slice(firstAirborne, lastAirborne + 1);
}

// ---------------------------------------------------------------------------
// Curvature-aware adaptive downsampling
// ---------------------------------------------------------------------------

/**
 * Downsample a dense path to at most `maxPoints` while preserving detail
 * at curves.  Uses the Ramer-Douglas-Peucker algorithm adapted for 3D
 * elevated points.
 *
 * This replaces the naive stride-based thinning that loses curve detail.
 */
export function adaptiveDownsample(
  points: ElevatedPoint[],
  maxPoints: number,
): ElevatedPoint[] {
  if (points.length <= maxPoints) return points;

  // Use iterative RDP with an adaptive epsilon.
  // Start with a generous epsilon and tighten until we're under maxPoints.
  let lo = 0;
  let hi = 5; // degrees — large enough for any trail
  let bestResult = points;

  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const result = rdpSimplify(points, mid);
    if (result.length <= maxPoints) {
      bestResult = result;
      hi = mid;
    } else {
      lo = mid;
    }
    if (Math.abs(result.length - maxPoints) < maxPoints * 0.05) break;
  }

  // If RDP under-sampled, evenly pick more points.
  if (bestResult.length < maxPoints * 0.5 && points.length > maxPoints) {
    return uniformSample(points, maxPoints);
  }

  return bestResult;
}

/** Ramer-Douglas-Peucker simplification for 3D points. */
function rdpSimplify(
  points: ElevatedPoint[],
  epsilon: number,
): ElevatedPoint[] {
  if (points.length <= 2) return points.slice();

  // Find the point with the maximum perpendicular distance.
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/** Perpendicular distance from a point to a line segment (2D, using lng/lat). */
function perpendicularDistance(
  point: ElevatedPoint,
  lineStart: ElevatedPoint,
  lineEnd: ElevatedPoint,
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const denom = dx * dx + dy * dy;

  if (denom < 1e-12) {
    const ex = point[0] - lineStart[0];
    const ey = point[1] - lineStart[1];
    return Math.sqrt(ex * ex + ey * ey);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / denom,
    ),
  );

  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  const ex = point[0] - projX;
  const ey = point[1] - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Uniform sampling — picks evenly-spaced points, always including first and last. */
function uniformSample(
  points: ElevatedPoint[],
  count: number,
): ElevatedPoint[] {
  if (points.length <= count) return points;
  const out: ElevatedPoint[] = [points[0]];
  const step = (points.length - 1) / (count - 1);
  for (let i = 1; i < count - 1; i++) {
    out.push(points[Math.round(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Spike / backtrack removal
// ---------------------------------------------------------------------------

/**
 * Remove "spike" points where the path reverses direction sharply,
 * creating V-shaped artifacts.
 *
 * A spike is detected when the angle between consecutive direction vectors
 * is extremely acute (nearly 180° turn).  The threshold uses the cosine
 * of the direction change between (prev→current) and (current→next).
 *
 * Works on 2D [lng, lat] paths.
 */
export function removeSpikePoints(
  path: [number, number][],
  altitudes: Array<number | null>,
  cosThreshold: number = -0.5, // cos(120°) — reject turns sharper than 120°
): { path: [number, number][]; altitudes: Array<number | null> } {
  if (path.length < 3) return { path, altitudes };

  const keep: boolean[] = new Array(path.length).fill(true);
  let removed = 0;

  // Multiple passes: removing a spike can expose adjacent spikes.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 1; i < path.length - 1; i++) {
      if (!keep[i]) continue;

      // Find previous kept point.
      let prevIdx = i - 1;
      while (prevIdx >= 0 && !keep[prevIdx]) prevIdx--;
      if (prevIdx < 0) continue;

      // Find next kept point.
      let nextIdx = i + 1;
      while (nextIdx < path.length && !keep[nextIdx]) nextIdx++;
      if (nextIdx >= path.length) continue;

      const prev = path[prevIdx];
      const curr = path[i];
      const next = path[nextIdx];

      // Direction vectors.
      const dx1 = curr[0] - prev[0];
      const dy1 = curr[1] - prev[1];
      const dx2 = next[0] - curr[0];
      const dy2 = next[1] - curr[1];

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 < 1e-10 || len2 < 1e-10) continue;

      // Cosine of the angle between direction vectors.
      const cos = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);

      if (cos < cosThreshold) {
        keep[i] = false;
        removed++;
        changed = true;
      }
    }
    if (!changed) break;
  }

  if (removed === 0) return { path, altitudes };

  const newPath: [number, number][] = [];
  const newAlt: Array<number | null> = [];
  for (let i = 0; i < path.length; i++) {
    if (keep[i]) {
      newPath.push(path[i]);
      newAlt.push(altitudes[i] ?? null);
    }
  }

  return { path: newPath, altitudes: newAlt };
}

// ---------------------------------------------------------------------------
// Sharp-corner rounding (pre-spline loop prevention)
// ---------------------------------------------------------------------------

/**
 * Round sharp corners in a 3D waypoint path by replacing each sharp turn
 * with a smooth quadratic Bézier arc.
 *
 * Without this, the Catmull-Rom spline overshoots at sharp turns (>60°)
 * and creates self-intersecting loops.  The Bézier arc provides a smooth
 * set of guide points that the spline can follow without looping.
 *
 * @param points       Ordered waypoints [lng, lat, alt].
 * @param thresholdDeg Heading change (degrees) above which a corner is rounded.
 * @returns Augmented waypoint list with arc points replacing sharp corners.
 */
export function roundSharpCorners3D(
  points: ElevatedPoint[],
  thresholdDeg: number = 20,
): ElevatedPoint[] {
  if (points.length < 3) return points;

  const thresholdRad = (thresholdDeg * Math.PI) / 180;
  const result: ElevatedPoint[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const distPrev = Math.sqrt(
      (curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2,
    );
    const distNext = Math.sqrt(
      (next[0] - curr[0]) ** 2 + (next[1] - curr[1]) ** 2,
    );

    // Skip very short segments where heading is numerically unreliable.
    if (distPrev < 5e-4 || distNext < 5e-4) {
      result.push(curr);
      continue;
    }

    const headingIn = Math.atan2(curr[0] - prev[0], curr[1] - prev[1]);
    const headingOut = Math.atan2(next[0] - curr[0], next[1] - curr[1]);
    let delta = headingOut - headingIn;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const absDelta = Math.abs(delta);

    if (absDelta > thresholdRad) {
      // Setback: how far from the corner to start/end the arc.
      // Capped at 45% of the shorter adjacent segment to avoid overlap
      // when consecutive corners are close together.
      const setback = Math.min(distPrev, distNext) * 0.45;

      // Tangent point on the incoming segment (near curr, toward prev).
      const t1Factor = setback / distPrev;
      const T1: ElevatedPoint = [
        curr[0] + (prev[0] - curr[0]) * t1Factor,
        curr[1] + (prev[1] - curr[1]) * t1Factor,
        curr[2] + (prev[2] - curr[2]) * t1Factor,
      ];

      // Tangent point on the outgoing segment (near curr, toward next).
      const t2Factor = setback / distNext;
      const T2: ElevatedPoint = [
        curr[0] + (next[0] - curr[0]) * t2Factor,
        curr[1] + (next[1] - curr[1]) * t2Factor,
        curr[2] + (next[2] - curr[2]) * t2Factor,
      ];

      // Number of arc points scales with the sharpness of the turn.
      const arcCount = Math.max(
        6,
        Math.min(14, Math.round((10 * absDelta) / Math.PI)),
      );

      // Quadratic Bézier: P(t) = (1-t)²·T1 + 2(1-t)t·curr + t²·T2
      for (let j = 0; j <= arcCount; j++) {
        const t = j / arcCount;
        const u = 1 - t;
        result.push([
          u * u * T1[0] + 2 * u * t * curr[0] + t * t * T2[0],
          u * u * T1[1] + 2 * u * t * curr[1] + t * t * T2[1],
          u * u * T1[2] + 2 * u * t * curr[2] + t * t * T2[2],
        ]);
      }
    } else {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * Round sharp corners in a 2D path (for active / live trails).
 * Same algorithm as roundSharpCorners3D but operates on [lng, lat] arrays.
 */
export function roundSharpCorners2D(
  points: [number, number][],
  thresholdDeg: number = 15,
): [number, number][] {
  if (points.length < 3) return points;

  const thresholdRad = (thresholdDeg * Math.PI) / 180;
  const result: [number, number][] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const distPrev = Math.sqrt(
      (curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2,
    );
    const distNext = Math.sqrt(
      (next[0] - curr[0]) ** 2 + (next[1] - curr[1]) ** 2,
    );

    // Skip very short segments where heading is numerically unreliable.
    if (distPrev < 5e-4 || distNext < 5e-4) {
      result.push(curr);
      continue;
    }

    const headingIn = Math.atan2(curr[0] - prev[0], curr[1] - prev[1]);
    const headingOut = Math.atan2(next[0] - curr[0], next[1] - curr[1]);
    let delta = headingOut - headingIn;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const absDelta = Math.abs(delta);

    if (absDelta > thresholdRad) {
      const setback = Math.min(distPrev, distNext) * 0.45;

      const t1Factor = setback / distPrev;
      const T1: [number, number] = [
        curr[0] + (prev[0] - curr[0]) * t1Factor,
        curr[1] + (prev[1] - curr[1]) * t1Factor,
      ];

      const t2Factor = setback / distNext;
      const T2: [number, number] = [
        curr[0] + (next[0] - curr[0]) * t2Factor,
        curr[1] + (next[1] - curr[1]) * t2Factor,
      ];

      const arcCount = Math.max(
        6,
        Math.min(12, Math.round((8 * absDelta) / Math.PI)),
      );

      for (let j = 0; j <= arcCount; j++) {
        const t = j / arcCount;
        const u = 1 - t;
        result.push([
          u * u * T1[0] + 2 * u * t * curr[0] + t * t * T2[0],
          u * u * T1[1] + 2 * u * t * curr[1] + t * t * T2[1],
        ]);
      }
    } else {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Post-spline self-intersection (loop) detection and removal
// ---------------------------------------------------------------------------

/** Check if two 2D line segments intersect (strict, not at endpoints). */
function segmentsIntersect(
  a1: ElevatedPoint,
  a2: ElevatedPoint,
  b1: ElevatedPoint,
  b2: ElevatedPoint,
): { hit: boolean; t: number } {
  const ax = a2[0] - a1[0],
    ay = a2[1] - a1[1];
  const bx = b2[0] - b1[0],
    by = b2[1] - b1[1];
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-15) return { hit: false, t: 0 };

  const cx = b1[0] - a1[0],
    cy = b1[1] - a1[1];
  const t = (cx * by - cy * bx) / denom;
  const u = (cx * ay - cy * ax) / denom;

  return { hit: t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99, t };
}

/**
 * Detect and remove self-intersecting loops in a splined path.
 *
 * Scans the path for pairs of non-adjacent segments that cross.  When a
 * crossing is found the loop between them is excised and replaced with
 * the actual intersection point, preserving path continuity.
 *
 * Uses a local search window (up to 120 segments ahead) so the cost is
 * O(N × window) rather than O(N²).
 */
export function removePathLoops(path: ElevatedPoint[]): ElevatedPoint[] {
  if (path.length < 8) return path;

  let result = path;
  const MAX_WINDOW = 120;

  // Multiple passes to catch nested / cascading loops.
  for (let pass = 0; pass < 5; pass++) {
    let found = false;

    outer: for (let i = 0; i < result.length - 3; i++) {
      const maxJ = Math.min(i + MAX_WINDOW, result.length - 1);
      for (let j = i + 2; j < maxJ; j++) {
        const { hit, t } = segmentsIntersect(
          result[i],
          result[i + 1],
          result[j],
          result[j + 1],
        );
        if (hit) {
          // Compute the intersection point.
          const ix: ElevatedPoint = [
            result[i][0] + t * (result[i + 1][0] - result[i][0]),
            result[i][1] + t * (result[i + 1][1] - result[i][1]),
            result[i][2] + t * (result[i + 1][2] - result[i][2]),
          ];

          // Replace the loop (indices i+1 through j) with the crossing point.
          const next = [...result.slice(0, i + 1), ix, ...result.slice(j + 1)];
          result = next;
          found = true;
          break outer;
        }
      }
    }

    if (!found) break;
  }

  return result;
}

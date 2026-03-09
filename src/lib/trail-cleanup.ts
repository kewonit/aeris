/**
 * Path cleanup algorithms for flight trails.
 *
 * Provides:
 * - Curvature-aware adaptive downsampling (Ramer-Douglas-Peucker)
 * - Spike / backtrack point removal
 * - Sharp-corner rounding (3D and 2D Bézier arcs)
 * - Post-spline self-intersection (loop) detection and removal
 */

import type { ElevatedPoint } from "./trail-spline";

// ---------------------------------------------------------------------------
// Curvature-aware adaptive downsampling
// ---------------------------------------------------------------------------

/**
 * Downsample a dense path to at most `maxPoints` while preserving detail
 * at curves.  Uses the Ramer-Douglas-Peucker algorithm adapted for 3D
 * elevated points.
 */
export function adaptiveDownsample(
  points: ElevatedPoint[],
  maxPoints: number,
): ElevatedPoint[] {
  if (points.length <= maxPoints) return points;

  let lo = 0;
  let hi = 5;
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
 */
export function removeSpikePoints(
  path: [number, number][],
  altitudes: Array<number | null>,
  cosThreshold: number = -0.5,
): { path: [number, number][]; altitudes: Array<number | null> } {
  if (path.length < 3) return { path, altitudes };

  const keep: boolean[] = new Array(path.length).fill(true);
  let removed = 0;

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 1; i < path.length - 1; i++) {
      if (!keep[i]) continue;

      let prevIdx = i - 1;
      while (prevIdx >= 0 && !keep[prevIdx]) prevIdx--;
      if (prevIdx < 0) continue;

      let nextIdx = i + 1;
      while (nextIdx < path.length && !keep[nextIdx]) nextIdx++;
      if (nextIdx >= path.length) continue;

      const prev = path[prevIdx];
      const curr = path[i];
      const next = path[nextIdx];

      const dx1 = curr[0] - prev[0];
      const dy1 = curr[1] - prev[1];
      const dx2 = next[0] - curr[0];
      const dy2 = next[1] - curr[1];

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 < 1e-10 || len2 < 1e-10) continue;

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
      const T1: ElevatedPoint = [
        curr[0] + (prev[0] - curr[0]) * t1Factor,
        curr[1] + (prev[1] - curr[1]) * t1Factor,
        curr[2] + (prev[2] - curr[2]) * t1Factor,
      ];

      const t2Factor = setback / distNext;
      const T2: ElevatedPoint = [
        curr[0] + (next[0] - curr[0]) * t2Factor,
        curr[1] + (next[1] - curr[1]) * t2Factor,
        curr[2] + (next[2] - curr[2]) * t2Factor,
      ];

      const arcCount = Math.max(
        6,
        Math.min(14, Math.round((10 * absDelta) / Math.PI)),
      );

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
 * Uses a local search window (up to 120 segments ahead) so the cost is
 * O(N × window) rather than O(N²).
 */
export function removePathLoops(path: ElevatedPoint[]): ElevatedPoint[] {
  if (path.length < 8) return path;

  let result = path;
  const MAX_WINDOW = 120;

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
          const ix: ElevatedPoint = [
            result[i][0] + t * (result[i + 1][0] - result[i][0]),
            result[i][1] + t * (result[i + 1][1] - result[i][1]),
            result[i][2] + t * (result[i + 1][2] - result[i][2]),
          ];

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

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

/** Iterative Ramer-Douglas-Peucker simplification for 3D points.
 *  Uses an explicit stack instead of recursion to avoid stack overflow
 *  on trails with 5000+ points, and eliminates per-call .slice() allocations. */
function rdpSimplify(
  points: ElevatedPoint[],
  epsilon: number,
): ElevatedPoint[] {
  const n = points.length;
  if (n <= 2) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Explicit stack of [startIndex, endIndex] ranges to process
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = start;

    const first = points[start];
    const last = points[end];

    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      if (maxIdx - start > 1) stack.push([start, maxIdx]);
      if (end - maxIdx > 1) stack.push([maxIdx, end]);
    }
  }

  const result: ElevatedPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/** Perpendicular distance from a point to a line segment (2D, using lng/lat).
 *  Latitude-aware: scales longitude by cos(avgLat) so the distance metric
 *  is approximately equidistant at high latitudes. */
function perpendicularDistance(
  point: ElevatedPoint,
  lineStart: ElevatedPoint,
  lineEnd: ElevatedPoint,
): number {
  // Scale longitude by cos(average latitude) for accurate distance at
  // high latitudes where 1° lng is much shorter than 1° lat.
  const avgLat = (((point[1] + lineStart[1] + lineEnd[1]) / 3) * Math.PI) / 180;
  const cosLat = Math.max(0.1, Math.cos(avgLat));

  const dx = (lineEnd[0] - lineStart[0]) * cosLat;
  const dy = lineEnd[1] - lineStart[1];
  const denom = dx * dx + dy * dy;

  if (denom < 1e-12) {
    const ex = (point[0] - lineStart[0]) * cosLat;
    const ey = point[1] - lineStart[1];
    return Math.sqrt(ex * ex + ey * ey);
  }

  const px = (point[0] - lineStart[0]) * cosLat;
  const py = point[1] - lineStart[1];
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / denom));

  const projX = t * dx;
  const projY = t * dy;
  const ex = px - projX;
  const ey = py - projY;
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
 * Remove "spike" points where the path reverses direction sharply
 * (V-shaped artifacts) or has asymmetric segment lengths (GPS noise).
 */
export function removeSpikePoints(
  path: [number, number][],
  altitudes: Array<number | null>,
  cosThreshold: number = -0.05,
): { path: [number, number][]; altitudes: Array<number | null> } {
  if (path.length < 3) return { path, altitudes };

  // Pre-filter: mark points with NaN/Infinity coordinates for removal.
  const keep: boolean[] = new Array(path.length).fill(true);
  let removed = 0;
  for (let i = 0; i < path.length; i++) {
    if (!Number.isFinite(path[i][0]) || !Number.isFinite(path[i][1])) {
      keep[i] = false;
      removed++;
    }
  }

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

      // Hard direction reversal (>~120°)
      if (cos < cosThreshold) {
        keep[i] = false;
        removed++;
        changed = true;
        continue;
      }

      // Moderate turn (>90°) with asymmetric segment lengths (GPS spike).
      const lengthRatio = Math.max(len1, len2) / Math.min(len1, len2);
      if (cos < 0) {
        if (lengthRatio > 4) {
          keep[i] = false;
          removed++;
          changed = true;
          continue;
        }
      }

      const lineDx = next[0] - prev[0];
      const lineDy = next[1] - prev[1];
      const lineLenSq = lineDx * lineDx + lineDy * lineDy;
      if (lineLenSq >= 1e-12) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((curr[0] - prev[0]) * lineDx + (curr[1] - prev[1]) * lineDy) /
              lineLenSq,
          ),
        );
        const projX = prev[0] + t * lineDx;
        const projY = prev[1] + t * lineDy;
        const perpDist = Math.sqrt(
          (curr[0] - projX) ** 2 + (curr[1] - projY) ** 2,
        );
        const lineLength = Math.sqrt(lineLenSq);

        if (lengthRatio > 4 && perpDist / Math.max(lineLength, 1e-10) > 0.08) {
          keep[i] = false;
          removed++;
          changed = true;
          continue;
        }
      }

      let nextNextIdx = nextIdx + 1;
      while (nextNextIdx < path.length && !keep[nextNextIdx]) nextNextIdx++;

      if (nextNextIdx < path.length) {
        const following = path[nextNextIdx];
        const baseDx = following[0] - prev[0];
        const baseDy = following[1] - prev[1];
        const baseLenSq = baseDx * baseDx + baseDy * baseDy;

        if (baseLenSq >= 1e-10) {
          const currProjection =
            ((curr[0] - prev[0]) * baseDx + (curr[1] - prev[1]) * baseDy) /
            baseLenSq;
          const nextProjection =
            ((next[0] - prev[0]) * baseDx + (next[1] - prev[1]) * baseDy) /
            baseLenSq;
          const currCross =
            baseDx * (curr[1] - prev[1]) - baseDy * (curr[0] - prev[0]);
          const nextCross =
            baseDx * (next[1] - prev[1]) - baseDy * (next[0] - prev[0]);

          const len3 = Math.sqrt(
            (following[0] - next[0]) ** 2 + (following[1] - next[1]) ** 2,
          );
          const direct = Math.sqrt(baseLenSq);
          const detourRatio = (len1 + len2 + len3) / Math.max(direct, 1e-10);
          const alternatingSides = currCross * nextCross < 0;
          const backtracks = nextProjection < currProjection - 0.05;
          const crossTrackRatio =
            Math.max(Math.abs(currCross), Math.abs(nextCross)) /
            Math.max(direct, 1e-10);

          if (
            alternatingSides &&
            backtracks &&
            detourRatio > 1.35 &&
            crossTrackRatio > 0.003
          ) {
            keep[i] = false;
            keep[nextIdx] = false;
            removed += 2;
            changed = true;
            continue;
          }
        }
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
// Distance-based outlier removal
// ---------------------------------------------------------------------------

/**
 * Remove points whose perpendicular distance to the line connecting
 * their kept neighbours exceeds `thresholdMultiplier` × median segment
 * distance. Catches GPS/MLAT artifacts that spike removal misses.
 */
export function removeDistanceOutliers(
  path: [number, number][],
  altitudes: Array<number | null>,
  thresholdMultiplier: number = 3.0,
): { path: [number, number][]; altitudes: Array<number | null> } {
  if (path.length < 5) return { path, altitudes };

  // Calculate all segment distances for the median baseline.
  const segDists: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    segDists.push(Math.sqrt(dx * dx + dy * dy));
  }

  const sorted = [...segDists].sort((a, b) => a - b);
  const medianDist = sorted[Math.floor(sorted.length / 2)];
  if (medianDist < 1e-8) return { path, altitudes };

  const threshold = medianDist * thresholdMultiplier;
  const keep = new Array(path.length).fill(true);
  // Always keep first and last points.
  let removed = 0;

  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let i = 1; i < path.length - 1; i++) {
      if (!keep[i]) continue;

      // Find kept neighbours.
      let prevIdx = i - 1;
      while (prevIdx >= 0 && !keep[prevIdx]) prevIdx--;
      if (prevIdx < 0) continue;

      let nextIdx = i + 1;
      while (nextIdx < path.length && !keep[nextIdx]) nextIdx++;
      if (nextIdx >= path.length) continue;

      const prev = path[prevIdx];
      const curr = path[i];
      const next = path[nextIdx];

      // Perpendicular distance from curr to line(prev, next).
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const lineLenSq = dx * dx + dy * dy;

      let perpDist: number;
      if (lineLenSq < 1e-12) {
        perpDist = Math.sqrt(
          (curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2,
        );
      } else {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((curr[0] - prev[0]) * dx + (curr[1] - prev[1]) * dy) / lineLenSq,
          ),
        );
        const projX = prev[0] + t * dx;
        const projY = prev[1] + t * dy;
        perpDist = Math.sqrt((curr[0] - projX) ** 2 + (curr[1] - projY) ** 2);
      }

      if (perpDist > threshold) {
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
  const MAX_WINDOW = 500;

  for (let pass = 0; pass < 8; pass++) {
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

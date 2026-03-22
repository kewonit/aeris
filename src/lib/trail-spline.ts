/**
 * Centripetal Catmull-Rom spline interpolation for 3D flight trails.
 *
 * The centripetal parameterisation (alpha = 0.5) avoids cusps and self-
 * intersections that the uniform variant can produce.
 *
 * Reference: E. Yuksel, S. Schaefer, J. Keyser – "On the parameterization
 * of Catmull-Rom curves" (2011).
 */

export type ElevatedPoint = [lng: number, lat: number, altitude: number];

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
  t01: number,
): ElevatedPoint {
  const t0 = 0;
  const t1 = crKnot(t0, P0, P1);
  const t2 = crKnot(t1, P1, P2);
  const t3 = crKnot(t2, P2, P3);

  const t = t1 + t01 * (t2 - t1);

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
  const dist = Math.sqrt(dx * dx + dy * dy);
  const heading = Math.atan2(dx, dy);

  let curvatureFactor = 0;
  if (prevHeading !== null) {
    let delta = heading - prevHeading;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    curvatureFactor = Math.abs(delta) / Math.PI;
  }

  const distFactor = Math.min(1, dist / 2);
  const raw =
    minPts + (maxPts - minPts) * Math.max(distFactor, curvatureFactor);
  return Math.max(minPts, Math.min(maxPts, Math.round(raw)));
}

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

  if (points.length === 2) {
    return linearInterpolateSegment(points[0], points[1], 8);
  }

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

    const headingBefore = i > 0 ? headings[i - 1] : headings[i];
    const headingAfter =
      i < headings.length - 1 ? headings[i + 1] : headings[i];

    let deltaIn = headings[i] - headingBefore;
    if (deltaIn > Math.PI) deltaIn -= 2 * Math.PI;
    if (deltaIn < -Math.PI) deltaIn += 2 * Math.PI;

    let deltaOut = headingAfter - headings[i];
    if (deltaOut > Math.PI) deltaOut -= 2 * Math.PI;
    if (deltaOut < -Math.PI) deltaOut += 2 * Math.PI;

    const maxDelta = Math.max(Math.abs(deltaIn), Math.abs(deltaOut));

    const STRAIGHT_THRESHOLD = (5 * Math.PI) / 180;
    const CURVE_THRESHOLD = (20 * Math.PI) / 180;
    const tension =
      maxDelta <= STRAIGHT_THRESHOLD
        ? 0.92
        : maxDelta >= CURVE_THRESHOLD
          ? 0.0
          : 0.92 *
            (1.0 -
              (maxDelta - STRAIGHT_THRESHOLD) /
                (CURVE_THRESHOLD - STRAIGHT_THRESHOLD));

    result.push(P1);

    for (let j = 1; j < nPts; j++) {
      const t = j / nPts;

      if (tension >= 0.98) {
        result.push(lerpPoint(P1, P2, t));
      } else if (tension <= 0.02) {
        result.push(crSegmentPoint(P0, P1, P2, P3, t));
      } else {
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

/**
 * Re-spline a window of points with C1 continuity at the boundaries.
 *
 * Unlike `catmullRomSpline3D`, which uses reflected virtual endpoints,
 * this function uses *actual* neighbouring points as tangent anchors.
 * This produces correct heading at the window boundaries, ideal for
 * smoothing a junction between two separately-generated paths.
 *
 * @param anchorBefore  Point immediately before the window (tangent ref only)
 * @param windowPoints  Points to re-spline (≥2, will be interpolated)
 * @param anchorAfter   Point immediately after the window (tangent ref only)
 */
export function catmullRomRespline3D(
  anchorBefore: ElevatedPoint,
  windowPoints: ElevatedPoint[],
  anchorAfter: ElevatedPoint,
  minPtsPerSeg: number = 2,
  maxPtsPerSeg: number = 4,
): ElevatedPoint[] {
  if (windowPoints.length < 2) return windowPoints.slice();

  if (windowPoints.length === 2) {
    // With only 2 window points, build a 4-point extended array and
    // spline the single segment between them.
    const extended = [
      anchorBefore,
      windowPoints[0],
      windowPoints[1],
      anchorAfter,
    ];
    return catmullRomSplineCore(extended, 1, 2, minPtsPerSeg, maxPtsPerSeg);
  }

  // Build extended array: anchor + window + anchor.
  // catmullRomSplineCore uses extended[idx-1] and extended[idx+2] as
  // neighbouring control points, so anchors naturally provide the
  // correct tangent at the first and last window point.
  const extended = [anchorBefore, ...windowPoints, anchorAfter];
  return catmullRomSplineCore(
    extended,
    1,
    windowPoints.length,
    minPtsPerSeg,
    maxPtsPerSeg,
  );
}

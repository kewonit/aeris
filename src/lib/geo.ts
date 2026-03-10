export function snapLngToReference(lng: number, refLng: number): number {
  if (!Number.isFinite(lng) || !Number.isFinite(refLng)) return lng;
  let x = lng;
  while (x - refLng > 180) x -= 360;
  while (x - refLng < -180) x += 360;
  return x;
}

export function unwrapLngPath(
  path: Array<[lng: number, lat: number]>,
): Array<[lng: number, lat: number]> {
  if (path.length < 2) return path.slice();
  const [firstLng, firstLat] = path[0];
  const out: Array<[number, number]> = [[firstLng, firstLat]];
  let refLng = firstLng;
  for (let i = 1; i < path.length; i++) {
    const [lng, lat] = path[i];
    const nextLng = snapLngToReference(lng, refLng);
    out.push([nextLng, lat]);
    refLng = nextLng;
  }
  return out;
}

// ── Great-circle utilities ─────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Angular distance between two points in radians (Haversine formula).
 * Accurate for all distances on the sphere.
 */
export function haversineDistanceRad(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const la1 = lat1 * DEG2RAD;
  const la2 = lat2 * DEG2RAD;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Approximate great-circle distance in degrees (for quick threshold checks).
 */
export function gcDistanceDeg(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  return haversineDistanceRad(lng1, lat1, lng2, lat2) * RAD2DEG;
}

/**
 * Intermediate point on a great circle at fraction `t` ∈ [0, 1].
 * Uses the standard spherical interpolation formula.
 * Reference: https://www.movable-type.co.uk/scripts/latlong.html
 */
export function greatCircleIntermediate(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
  t: number,
): [number, number] {
  // Degenerate cases
  if (t <= 0) return [lng1, lat1];
  if (t >= 1) return [lng2, lat2];

  const la1 = lat1 * DEG2RAD;
  const lo1 = lng1 * DEG2RAD;
  const la2 = lat2 * DEG2RAD;
  const lo2 = lng2 * DEG2RAD;

  const d = haversineDistanceRad(lng1, lat1, lng2, lat2);

  // Very short distance — linear interpolation is fine and avoids division by ~0
  if (d < 1e-9) {
    return [lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t];
  }

  const sinD = Math.sin(d);
  const a = Math.sin((1 - t) * d) / sinD;
  const b = Math.sin(t * d) / sinD;

  const x =
    a * Math.cos(la1) * Math.cos(lo1) + b * Math.cos(la2) * Math.cos(lo2);
  const y =
    a * Math.cos(la1) * Math.sin(lo1) + b * Math.cos(la2) * Math.sin(lo2);
  const z = a * Math.sin(la1) + b * Math.sin(la2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG;
  const lng = Math.atan2(y, x) * RAD2DEG;

  return [lng, lat];
}

/**
 * Densify a path segment along a great-circle arc.
 * Inserts intermediate points between each consecutive pair of points
 * when the segment angular distance exceeds `thresholdDeg`.
 *
 * Works with [lng, lat, altitude] elevated points. Altitude is linearly
 * interpolated.
 */
export function densifyGreatCircle(
  path: Array<[number, number, number]>,
  thresholdDeg: number = 0.5,
  maxPointsPerSegment: number = 32,
): Array<[number, number, number]> {
  if (path.length < 2) return path.slice();

  const result: Array<[number, number, number]> = [path[0]];

  for (let i = 0; i < path.length - 1; i++) {
    const [lng1, lat1, alt1] = path[i];
    const [lng2, lat2, alt2] = path[i + 1];

    const dist = gcDistanceDeg(lng1, lat1, lng2, lat2);

    if (dist > thresholdDeg) {
      const n = Math.min(
        maxPointsPerSegment,
        Math.max(2, Math.ceil(dist / thresholdDeg)),
      );
      for (let j = 1; j < n; j++) {
        const t = j / n;
        const [lng, lat] = greatCircleIntermediate(lng1, lat1, lng2, lat2, t);
        const alt = alt1 + (alt2 - alt1) * t;
        result.push([lng, lat, alt]);
      }
    }

    result.push(path[i + 1]);
  }

  return result;
}

/**
 * Densify a 2D path along great-circle arcs.
 */
export function densifyGreatCircle2D(
  path: Array<[number, number]>,
  thresholdDeg: number = 0.5,
  maxPointsPerSegment: number = 32,
): Array<[number, number]> {
  if (path.length < 2) return path.slice();

  const result: Array<[number, number]> = [path[0]];

  for (let i = 0; i < path.length - 1; i++) {
    const [lng1, lat1] = path[i];
    const [lng2, lat2] = path[i + 1];

    const dist = gcDistanceDeg(lng1, lat1, lng2, lat2);

    if (dist > thresholdDeg) {
      const n = Math.min(
        maxPointsPerSegment,
        Math.max(2, Math.ceil(dist / thresholdDeg)),
      );
      for (let j = 1; j < n; j++) {
        const t = j / n;
        const [lng, lat] = greatCircleIntermediate(lng1, lat1, lng2, lat2, t);
        result.push([lng, lat]);
      }
    }

    result.push(path[i + 1]);
  }

  return result;
}

/**
 * Check if a path segment crosses the antimeridian (|Δlng| > 180).
 * Returns true if the segment wraps around.
 */
export function crossesAntimeridian(lng1: number, lng2: number): boolean {
  return Math.abs(lng2 - lng1) > 180;
}

/**
 * Split a path into separate segments at antimeridian crossings.
 * Each segment is a contiguous array of coordinates that do NOT cross
 * the antimeridian, suitable for MapLibre GeoJSON line rendering on a globe.
 */
export function splitAtAntimeridian(
  path: Array<[number, number]>,
): Array<Array<[number, number]>> {
  if (path.length < 2) return [path.slice()];

  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [path[0]];

  for (let i = 1; i < path.length; i++) {
    const prevLng = path[i - 1][0];
    const currLng = path[i][0];

    if (crossesAntimeridian(prevLng, currLng)) {
      // Compute the crossing latitude by linear interpolation
      const prevLat = path[i - 1][1];
      const currLat = path[i][1];

      // Normalize longitudes for interpolation
      let norm1 = prevLng;
      let norm2 = currLng;
      if (norm2 - norm1 > 180) norm2 -= 360;
      else if (norm1 - norm2 > 180) norm2 += 360;

      const dLng = norm2 - norm1;
      if (Math.abs(dLng) > 1e-10) {
        // Find t where longitude crosses ±180
        const crossLng = prevLng > 0 ? 180 : -180;
        const t = (crossLng - norm1) / dLng;
        const crossLat = prevLat + (currLat - prevLat) * t;

        // End current segment at the crossing
        current.push([crossLng, crossLat]);
        segments.push(current);

        // Start new segment from the other side
        current = [[-crossLng, crossLat]];
      } else {
        segments.push(current);
        current = [];
      }
    }

    current.push(path[i]);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments.filter((s) => s.length >= 2);
}

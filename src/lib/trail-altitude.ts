/**
 * Altitude profile smoothing and ground-segment filtering.
 *
 * Used by trail-stitching to produce smooth altitude curves for
 * historical flight tracks that have sparse waypoints.
 */

export type WaypointLike = {
  onGround: boolean;
  latitude: number | null;
  longitude: number | null;
  baroAltitude: number | null;
};

/**
 * Smooth altitude values using box filtering and rate-of-change limiting.
 *
 * Historical trails have staircase-like altitude profiles from sparse
 * waypoints.  This applies:
 * 1. A gentle 5-pass box filter to remove staircase artifacts.
 * 2. A bi-directional rate-of-change limiter for realistic climb/descent.
 */
export function smoothAltitudeProfile(
  altitudes: Array<number | null>,
  defaultAlt: number,
): number[] {
  const safeDefault = Number.isFinite(defaultAlt) ? defaultAlt : 0;
  const filled = fillNullAltitudes(altitudes, safeDefault);

  if (filled.length < 4) return filled;

  // Pass 1: Gentle 5-pass box filter.
  let current = filled;
  for (let pass = 0; pass < 5; pass++) {
    const next = [...current];
    for (let i = 1; i < current.length - 1; i++) {
      const val =
        current[i - 1] * 0.25 + current[i] * 0.5 + current[i + 1] * 0.25;
      // Guard: if any input was NaN/Infinity, preserve the center value.
      next[i] = Number.isFinite(val) ? val : current[i];
    }
    current = next;
  }

  // Preserve original endpoint altitudes before rate limiting.
  const startAlt = current[0];
  const endAlt = current[current.length - 1];

  // Pass 2: Rate-of-change limiter for realistic climb/descent profiles.
  // Forward-then-backward passes are averaged to eliminate directional bias
  // (without averaging, monotonic climbs would accumulate systematic error).
  const fwd = [...current];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < fwd.length; i++) {
      const delta = fwd[i] - fwd[i - 1];
      const absDelta = Math.abs(delta);
      if (absDelta > 200) {
        const softMax = 200 + (absDelta - 200) * 0.6;
        fwd[i] = fwd[i - 1] + Math.sign(delta) * softMax;
      }
    }
  }

  const bwd = [...current];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = bwd.length - 2; i >= 0; i--) {
      const delta = bwd[i] - bwd[i + 1];
      const absDelta = Math.abs(delta);
      if (absDelta > 200) {
        const softMax = 200 + (absDelta - 200) * 0.6;
        bwd[i] = bwd[i + 1] + Math.sign(delta) * softMax;
      }
    }
  }

  // Average forward and backward passes to eliminate directional bias.
  const smoothed = current.map((_, i) => (fwd[i] + bwd[i]) / 2);

  // Restore endpoint altitudes exactly.
  smoothed[0] = startAlt;
  smoothed[smoothed.length - 1] = endAlt;

  return smoothed;
}

/**
 * Fill null altitude values using nearest-neighbour interpolation.
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

  return out.map((v) => (isNaN(v) ? defaultAlt : v));
}

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

  if (firstAirborne === -1) return null;

  return waypoints.slice(firstAirborne, lastAirborne + 1);
}

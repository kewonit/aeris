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

// ---------------------------------------------------------------------------
// Last-departure trimming
// ---------------------------------------------------------------------------

/**
 * Minimum consecutive ground points required to consider a sequence
 * a genuine landing (filters out single-point GPS noise on ground).
 */
const MIN_GROUND_BEFORE_TAKEOFF = 2;

/**
 * Trim a historical track to the last flight leg — from the last
 * departure airport to the current position.
 *
 * Scans for the last ground→airborne transition with at least
 * `MIN_GROUND_BEFORE_TAKEOFF` consecutive ground waypoints before it
 * (to filter GPS noise blips). Includes one ground waypoint before
 * takeoff as a departure anchor so the trail visually starts at the
 * airport.
 *
 * Falls back to `filterGroundSegments` when no multi-point ground
 * segment is found (single-leg flight or entirely airborne trace).
 *
 * Edge cases handled:
 * - All ground → returns null
 * - Entirely airborne → returns strip of leading/trailing ground via filterGroundSegments
 * - Single GPS ground blip → ignored (< MIN_GROUND_BEFORE_TAKEOFF)
 * - Aircraft landed at destination → trailing ground stripped
 * - Touch-and-go (brief ground contact) → ignored unless enough ground points
 */
export function trimToLastDeparture<T extends WaypointLike>(
  waypoints: T[],
): T[] | null {
  if (waypoints.length < 2) {
    return waypoints.length > 0 && !waypoints[0].onGround ? waypoints : null;
  }

  // Find the last ground→airborne transition preceded by enough ground points
  let lastTakeoffIdx = -1;

  for (let i = 1; i < waypoints.length; i++) {
    if (!waypoints[i].onGround && waypoints[i - 1].onGround) {
      // Count consecutive ground points before this transition
      let groundCount = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (waypoints[j].onGround) groundCount++;
        else break;
      }
      if (groundCount >= MIN_GROUND_BEFORE_TAKEOFF) {
        lastTakeoffIdx = i;
      }
    }
  }

  if (lastTakeoffIdx <= 0) {
    // No significant takeoff found — fall back to simple ground stripping
    return filterGroundSegments(waypoints);
  }

  // Include one ground point before takeoff as a departure airport anchor
  const startIdx = Math.max(0, lastTakeoffIdx - 1);

  // Strip trailing ground segments (destination taxi/parking)
  let endIdx = waypoints.length - 1;
  while (endIdx > startIdx && waypoints[endIdx].onGround) {
    endIdx--;
  }

  if (endIdx <= startIdx) return null;

  return waypoints.slice(startIdx, endIdx + 1);
}

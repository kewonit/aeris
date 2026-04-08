import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { unwrapLngPath } from "@/lib/geo";
import {
  adaptiveDownsample,
  removeSpikePoints,
  removeDistanceOutliers,
  catmullRomSpline3D,
} from "@/lib/trail-smoothing";
import type { ElevatedPoint } from "./flight-layer-constants";
import { TELEPORT_THRESHOLD } from "./flight-layer-constants";
import {
  trimAfterLargeJump,
  smoothAnimationAltitudes,
} from "./trail-path-utils";

const DISPLAY_SPLINE_MIN_POINTS = 6;
const DISPLAY_SPLINE_MAX_POINTS = 20;
const MAX_HISTORY_CONTROL_POINTS = 220;

// Re-export utility functions for backward compatibility.
export {
  buildStartupFallbackTrail,
  trimAfterLargeJump,
  smoothElevatedPath,
  smoothAnimationAltitudes,
  trimPathAheadOfAircraft,
} from "./trail-path-utils";

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

// ── Incremental Base Path Pinning ──────────────────────────────────────

/**
 * Prevents visual "sliding" of trail points when new GPS data arrives.
 *
 * When a trail grows by 1-2 GPS points, the Catmull-Rom spline
 * recalculation only truly affects the last few segments (where the new
 * control point enters the 4-point window). Points earlier in the path
 * produce identical output but may differ by floating-point noise.
 *
 * This function pins the stable region from the previous cached path
 * and only allows the tail to update, guaranteeing that once a trail
 * point is plotted, it never moves.
 */
export function pinIncrementalBasePath(
  oldBasePath: ElevatedPoint[],
  newBasePath: ElevatedPoint[],
): ElevatedPoint[] {
  // Only pin when trail grew (new GPS appended at end).
  // If the trail shrank or was reset, use the fresh path entirely.
  if (
    newBasePath.length <= oldBasePath.length ||
    oldBasePath.length < 30 ||
    newBasePath.length < 30
  ) {
    return newBasePath;
  }

  // Quick sanity check: the first few points should be nearly identical.
  // If they diverge, the trail was likely reset — skip pinning.
  const dx = Math.abs(oldBasePath[0][0] - newBasePath[0][0]);
  const dy = Math.abs(oldBasePath[0][1] - newBasePath[0][1]);
  if (dx > 0.001 || dy > 0.001) {
    return newBasePath;
  }

  // The Catmull-Rom spline with 6 segments/pair means each GPS point
  // generates ~6 output points.  A new GPS point affects the last 3
  // control points' spline output ≈ 18 output points.  Use 30 for
  // safety margin (covers edge cases with filtering changes).
  const TAIL_RECOMPUTE = 30;
  const pinEnd = Math.min(
    oldBasePath.length - TAIL_RECOMPUTE,
    newBasePath.length - TAIL_RECOMPUTE,
  );
  if (pinEnd <= 0) return newBasePath;

  // Build result: pinned stable region → short blend → fresh tail.
  const result: ElevatedPoint[] = new Array(newBasePath.length);

  // Stable region: exact copy from old path (zero visual change).
  for (let i = 0; i < pinEnd; i++) {
    result[i] = oldBasePath[i];
  }

  // Blend region: smooth transition avoids a visual seam between
  // pinned and freshly-computed regions.
  const BLEND_LEN = Math.min(12, newBasePath.length - pinEnd);
  for (let i = 0; i < BLEND_LEN; i++) {
    const t = (i + 1) / (BLEND_LEN + 1);
    const idx = pinEnd + i;
    const oldPt =
      idx < oldBasePath.length ? oldBasePath[idx] : newBasePath[idx];
    const newPt = newBasePath[idx];
    result[idx] = [
      oldPt[0] * (1 - t) + newPt[0] * t,
      oldPt[1] * (1 - t) + newPt[1] * t,
      oldPt[2] * (1 - t) + newPt[2] * t,
    ];
  }

  // Fresh tail: newly-computed points from the spline.
  for (let i = pinEnd + BLEND_LEN; i < newBasePath.length; i++) {
    result[i] = newBasePath[i];
  }

  return result;
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

  const toElevatedPoints = (
    path: [number, number][],
    altitudes: Array<number | null>,
    fallbackAlt: number,
  ): ElevatedPoint[] =>
    path.map((point, index) => [
      point[0],
      point[1],
      Number.isFinite(altitudes[index])
        ? Math.max(0, altitudes[index]!)
        : fallbackAlt,
    ]);

  const buildDisplaySpline = (
    elevated: ElevatedPoint[],
    maxControlPoints?: number,
  ): ElevatedPoint[] => {
    if (elevated.length < 2) {
      return elevated;
    }

    const controlPoints =
      maxControlPoints && elevated.length > maxControlPoints
        ? adaptiveDownsample(elevated, maxControlPoints)
        : elevated;

    return catmullRomSpline3D(
      controlPoints,
      DISPLAY_SPLINE_MIN_POINTS,
      DISPLAY_SPLINE_MAX_POINTS,
    );
  };

  const removeSuspiciousDisplayCuts = (
    elevated: ElevatedPoint[],
  ): ElevatedPoint[] => {
    if (elevated.length < 5) {
      return elevated;
    }

    const result = elevated.map(
      (point) => [point[0], point[1], point[2]] as ElevatedPoint,
    );

    for (let pass = 0; pass < 6; pass += 1) {
      let bestIndex = -1;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let index = 1; index < result.length - 2; index += 1) {
        const prev = result[index - 1];
        const current = result[index];
        const next = result[index + 1];
        const following = result[index + 2];
        const dx = following[0] - prev[0];
        const dy = following[1] - prev[1];
        const lenSq = dx * dx + dy * dy;

        if (lenSq < 1e-12) {
          continue;
        }

        const currentProjection =
          ((current[0] - prev[0]) * dx + (current[1] - prev[1]) * dy) / lenSq;
        const nextProjection =
          ((next[0] - prev[0]) * dx + (next[1] - prev[1]) * dy) / lenSq;
        const currentCross =
          dx * (current[1] - prev[1]) - dy * (current[0] - prev[0]);
        const nextCross = dx * (next[1] - prev[1]) - dy * (next[0] - prev[0]);
        const direct = Math.sqrt(lenSq);
        const len1 = Math.hypot(current[0] - prev[0], current[1] - prev[1]);
        const len2 = Math.hypot(next[0] - current[0], next[1] - current[1]);
        const len3 = Math.hypot(following[0] - next[0], following[1] - next[1]);
        const detourRatio = (len1 + len2 + len3) / Math.max(direct, 1e-10);
        const backtracks = nextProjection < currentProjection - 0.03;
        const alternatingSides = currentCross * nextCross < 0;
        const crossTrackRatio =
          Math.max(Math.abs(currentCross), Math.abs(nextCross)) /
          Math.max(direct, 1e-10);

        const turn1 =
          Math.atan2(next[1] - current[1], next[0] - current[0]) -
          Math.atan2(current[1] - prev[1], current[0] - prev[0]);
        const turn2 =
          Math.atan2(following[1] - next[1], following[0] - next[0]) -
          Math.atan2(next[1] - current[1], next[0] - current[0]);
        const normalizeTurn = (value: number) => {
          let nextValue = value;
          if (nextValue > Math.PI) nextValue -= Math.PI * 2;
          if (nextValue < -Math.PI) nextValue += Math.PI * 2;
          return nextValue;
        };
        const normalizedTurn1 = normalizeTurn(turn1);
        const normalizedTurn2 = normalizeTurn(turn2);
        const alternatingSharpTurns =
          normalizedTurn1 * normalizedTurn2 < 0 &&
          Math.abs(normalizedTurn1) > (75 * Math.PI) / 180 &&
          Math.abs(normalizedTurn2) > (75 * Math.PI) / 180;

        if (alternatingSharpTurns && detourRatio > 1.22) {
          const score =
            detourRatio + Math.abs(normalizedTurn1) + Math.abs(normalizedTurn2);

          if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
          }

          continue;
        }

        if (
          backtracks &&
          detourRatio > 1.12 &&
          (alternatingSides || crossTrackRatio > 0.002)
        ) {
          const score = detourRatio + crossTrackRatio;

          if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
          }
        }
      }

      if (bestIndex === -1) {
        break;
      }

      result.splice(bestIndex, 2);
    }

    return result;
  };

  if (isFullHistory) {
    // History already arrives denser than live GPS, so reduce it to
    // curvature-preserving control points first and then pass it through
    // the same display spline used for active trails.
    const fallbackAlt =
      trail.baroAltitude != null && Number.isFinite(trail.baroAltitude)
        ? trail.baroAltitude
        : 0;
    const rawAltitudes = altitudeSlice.map((a) =>
      a != null && Number.isFinite(a) ? a : fallbackAlt,
    );
    const altitudeMeters = smoothAnimationAltitudes(rawAltitudes, 3);
    const historyOutlierResult = removeDistanceOutliers(
      pathSlice,
      altitudeMeters,
      3.0,
    );
    const historySpikeResult = removeSpikePoints(
      historyOutlierResult.path,
      historyOutlierResult.altitudes,
    );

    return buildDisplaySpline(
      removeSuspiciousDisplayCuts(
        toElevatedPoints(
          historySpikeResult.path,
          historySpikeResult.altitudes,
          fallbackAlt,
        ),
      ),
      MAX_HISTORY_CONTROL_POINTS,
    );
  }

  // Active trails: filter GPS glitches then spline for visual smoothness.
  const outlierResult = removeDistanceOutliers(pathSlice, altitudeSlice, 3.0);
  const spikeResult = removeSpikePoints(
    outlierResult.path,
    outlierResult.altitudes,
  );

  const smoothedPath = spikeResult.path;

  const activeFallbackAlt =
    trail.baroAltitude != null && Number.isFinite(trail.baroAltitude)
      ? trail.baroAltitude
      : 0;
  const rawAltitudes = spikeResult.altitudes.map((a) =>
    a != null && Number.isFinite(a) ? a : activeFallbackAlt,
  );
  const altitudeMeters = smoothAnimationAltitudes(rawAltitudes, 3);

  return buildDisplaySpline(
    removeSuspiciousDisplayCuts(
      toElevatedPoints(smoothedPath, altitudeMeters, activeFallbackAlt),
    ),
  );
}

// ── Visible Trail Point Builder ────────────────────────────────────────

/**
 * Builds the final visible trail points for rendering.
 * When cachedBasePath is provided, skips the expensive smoothing/densification
 * and only normalizes the final points for rendering.
 */
export function buildVisibleTrailPoints(
  trail: TrailEntry,
  _animFlight: FlightState | undefined,
  trailDistance: number,
  cachedBasePath?: ElevatedPoint[],
): ElevatedPoint[] {
  const denseBasePath =
    cachedBasePath ?? buildTrailBasePath(trail, trailDistance);

  return denseBasePath.map((p) => [
    p[0],
    p[1],
    Number.isFinite(p[2]) ? Math.max(0, p[2]) : 0,
  ]);
}

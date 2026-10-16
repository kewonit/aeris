import type { TrailEntry } from "@/lib/trails/types";
import { unwrapLngPath } from "@/lib/geo";
import {
  adaptiveDownsample,
  removeSpikePoints,
  removeDistanceOutliers,
  catmullRomSpline3D,
  roundSharpCorners3D,
} from "@/lib/trail-smoothing";
import type { ElevatedPoint } from "./flight-layer-constants";
import { TELEPORT_THRESHOLD } from "./flight-layer-constants";
import {
  cleanupControlPointArtifacts,
  getCurveFootprintMetrics,
  hasPreservedTurnWindow,
} from "./trail-curve-cleanup";
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

/**
 * Computes the expensive base path (smoothing + densification) for a trail.
 * This result is cacheable across animation frames - it only depends on
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

    const splined = catmullRomSpline3D(
      controlPoints,
      DISPLAY_SPLINE_MIN_POINTS,
      DISPLAY_SPLINE_MAX_POINTS,
    );

    // Post-smooth: round any remaining sharp corners that the Catmull-Rom
    // couldn't smooth from sparse control points (e.g. departure turns).
    return roundSharpCorners3D(splined, 8);
  };

  const preserveSparseTurnShape = (
    path: [number, number][],
    altitudes: Array<number | null>,
    fallbackAlt: number,
  ) => {
    const sourcePoints = toElevatedPoints(path, altitudes, fallbackAlt);
    const sourceHasTurnWindow = hasPreservedTurnWindow(sourcePoints);
    const spikeResult = removeSpikePoints(path, altitudes);

    if (!sourceHasTurnWindow) {
      return spikeResult;
    }

    const spikePoints = toElevatedPoints(
      spikeResult.path,
      spikeResult.altitudes,
      fallbackAlt,
    );
    const sourceFootprint = getCurveFootprintMetrics(sourcePoints);
    const spikeFootprint = getCurveFootprintMetrics(spikePoints);

    if (
      !hasPreservedTurnWindow(spikePoints) ||
      spikeResult.path.length < Math.max(3, Math.ceil(path.length / 2)) ||
      spikeFootprint.maxSpan < sourceFootprint.maxSpan * 0.65
    ) {
      return { path, altitudes };
    }

    return spikeResult;
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
    const historySpikeResult = preserveSparseTurnShape(
      historyOutlierResult.path,
      historyOutlierResult.altitudes,
      fallbackAlt,
    );

    return buildDisplaySpline(
      cleanupControlPointArtifacts(
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
  const activeFallbackAlt =
    trail.baroAltitude != null && Number.isFinite(trail.baroAltitude)
      ? trail.baroAltitude
      : 0;
  const outlierResult = removeDistanceOutliers(pathSlice, altitudeSlice, 3.0);
  const spikeResult = preserveSparseTurnShape(
    outlierResult.path,
    outlierResult.altitudes,
    activeFallbackAlt,
  );

  const smoothedPath = spikeResult.path;
  const rawAltitudes = spikeResult.altitudes.map((a) =>
    a != null && Number.isFinite(a) ? a : activeFallbackAlt,
  );
  const altitudeMeters = smoothAnimationAltitudes(rawAltitudes, 3);

  return buildDisplaySpline(
    cleanupControlPointArtifacts(
      toElevatedPoints(smoothedPath, altitudeMeters, activeFallbackAlt),
    ),
  );
}

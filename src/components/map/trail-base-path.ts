import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { snapLngToReference, unwrapLngPath } from "@/lib/geo";
import {
  removeSpikePoints,
  removeDistanceOutliers,
  catmullRomSpline3D,
} from "@/lib/trail-smoothing";
import type { ElevatedPoint } from "./flight-layer-constants";
import { TELEPORT_THRESHOLD } from "./flight-layer-constants";
import {
  trimAfterLargeJump,
  smoothAnimationAltitudes,
  trimPathAheadOfAircraft,
} from "./trail-path-utils";

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

  if (isFullHistory) {
    // The historical trail from trail-stitching.ts is already splined
    // via catmullRomSpline3D.  Re-splining would create V-shaped
    // overshoot artifacts at direction changes.  Only apply altitude
    // smoothing and light 2D filtering.
    const fallbackAlt =
      trail.baroAltitude != null && Number.isFinite(trail.baroAltitude)
        ? trail.baroAltitude
        : 0;
    const rawAltitudes = altitudeSlice.map((a) =>
      a != null && Number.isFinite(a) ? a : fallbackAlt,
    );
    const altitudeMeters = smoothAnimationAltitudes(rawAltitudes, 3);

    // Build the elevated points with smoothed altitudes.
    let elevated: ElevatedPoint[] = pathSlice.map(
      (p, i) =>
        [
          p[0],
          p[1],
          Number.isFinite(altitudeMeters[i])
            ? Math.max(0, altitudeMeters[i])
            : fallbackAlt,
        ] as ElevatedPoint,
    );

    // Light 2D box-filter to smooth the raw GPS live tail appended
    // by trail-stitching.  Barely affects the already-splined portion.
    if (elevated.length >= 3) {
      for (let pass = 0; pass < 2; pass++) {
        const next: ElevatedPoint[] = [elevated[0]];
        for (let i = 1; i < elevated.length - 1; i++) {
          next.push([
            elevated[i - 1][0] * 0.25 +
              elevated[i][0] * 0.5 +
              elevated[i + 1][0] * 0.25,
            elevated[i - 1][1] * 0.25 +
              elevated[i][1] * 0.5 +
              elevated[i + 1][1] * 0.25,
            elevated[i][2], // preserve already-smoothed altitude
          ]);
        }
        next.push(elevated[elevated.length - 1]);
        elevated = next;
      }
    }

    return elevated;
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

  const elevated: ElevatedPoint[] = smoothedPath.map((p, i) => [
    p[0],
    p[1],
    Number.isFinite(altitudeMeters[i])
      ? Math.max(0, altitudeMeters[i])
      : activeFallbackAlt,
  ]);

  if (elevated.length >= 2) {
    return catmullRomSpline3D(elevated, 6, 20);
  }
  return elevated;
}

// ── Visible Trail Point Builder ────────────────────────────────────────

/**
 * Builds the final visible trail points for rendering.
 * When cachedBasePath is provided, skips the expensive smoothing/densification
 * and only performs the cheap per-frame head attachment.
 */
export function buildVisibleTrailPoints(
  trail: TrailEntry,
  animFlight: FlightState | undefined,
  trailDistance: number,
  cachedBasePath?: ElevatedPoint[],
): ElevatedPoint[] {
  const denseBasePath =
    cachedBasePath ?? buildTrailBasePath(trail, trailDistance);

  if (
    animFlight &&
    animFlight.longitude != null &&
    animFlight.latitude != null &&
    denseBasePath.length > 1
  ) {
    const refLng = denseBasePath[denseBasePath.length - 1][0];
    const snappedLng = snapLngToReference(animFlight.longitude, refLng);
    const clipped = trimPathAheadOfAircraft(
      denseBasePath,
      [
        snappedLng,
        animFlight.latitude,
        Math.max(0, animFlight.baroAltitude ?? 0),
      ],
      animFlight.trueTrack ?? undefined,
    );

    return clipped.map((p) => [
      p[0],
      p[1],
      Number.isFinite(p[2]) ? Math.max(0, p[2]) : 0,
    ]);
  }

  return denseBasePath.map((p) => [
    p[0],
    p[1],
    Number.isFinite(p[2]) ? Math.max(0, p[2]) : 0,
  ]);
}

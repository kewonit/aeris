/**
 * Trail stitching — merges sparse historical track data with the high-
 * frequency live trail to produce a single smooth path.
 *
 * Extracted from the ~120-line inline `mergedTrails` computation in
 * flight-tracker.tsx so the logic is testable, documented, and the
 * thresholds are named constants.
 */

import {
  snapLngToReference,
  unwrapLngPath,
  greatCircleIntermediate,
} from "@/lib/geo";
import {
  catmullRomSpline3D,
  catmullRomRespline3D,
  filterGroundSegments,
  smoothAltitudeProfile,
  adaptiveDownsample,
  removeSpikePoints,
  roundSharpCorners3D,
  removePathLoops,
} from "@/lib/trail-smoothing";
import type { FlightTrack } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import type { FlightState } from "@/lib/opensky";

// ---------------------------------------------------------------------------
// Named thresholds (were magic numbers in the old inline code)
// ---------------------------------------------------------------------------

/** Number of recent live-trail points to append after the historical track. */
const LIVE_TAIL_POINT_COUNT = 24;

/** Maximum search depth (from end) when looking for overlap between the
 *  historical track and the live tail.  Increased to account for spline
 *  densification of sparse waypoints. */
const OVERLAP_SEARCH_WINDOW = 150;

/** If the closest point on the historical track is within this distance
 *  (degrees) of the first live-tail point, snap them together. */
const MERGE_SNAP_DEG = 0.06;

/** If the gap is larger than MERGE_SNAP but smaller than this, insert a
 *  smooth bridge between the track end and the live tail start. */
const CONNECT_BRIDGE_DEG = 0.07;

/** Maximum gap (degrees) before we give up trying to connect stale history
 *  to the live tail.  Scaled by altitude: low flights are more constrained
 *  because their waypoints are denser. */
const MAX_GAP_HIGH_ALT_DEG = 3.5;
const MAX_GAP_LOW_ALT_DEG = 1.25;
const LOW_ALTITUDE_THRESHOLD = 6_000; // meters

/** If the track's last waypoint is this old AND the gap is moderate, treat
 *  the historical data as disconnected (stale). */
const STALE_DISCONNECT_GAP_DEG = 0.06;
const STALE_DISCONNECT_AGE_SEC = 900;
const MODERATE_DISCONNECT_GAP_DEG = 0.1;
const MODERATE_DISCONNECT_AGE_SEC = 300;
const HARD_DISCONNECT_GAP_DEG = 0.25;

/** Default speed assumption when the flight state doesn't report one. */
const DEFAULT_SPEED_MPS = 140;
const MIN_SPEED_MPS = 30;

/** Maximum distance (degrees) from the live position to the nearest track
 *  waypoint before we reject the track as belonging to a different flight
 *  or being hopelessly stale. */
const TRACK_REJECT_HIGH_ALT_DEG = 6;
const TRACK_REJECT_LOW_ALT_DEG = 2.8;

/** Maximum number of interpolated steps when bridging a gap. */
const BRIDGE_MAX_STEPS = 24;
const BRIDGE_MIN_STEPS = 6;
const BRIDGE_STEP_SIZE_DEG = 0.15;

/** Maximum points after spline interpolation before downsampling. */
const MAX_SPLINED_POINTS = 1800;

// ---------------------------------------------------------------------------
// Slerp-based great-circle bridge (for smooth gap interpolation)
// ---------------------------------------------------------------------------

/**
 * Spherical linear interpolation between two [lng, lat] points.
 * More accurate than linear interpolation for gaps > ~0.1°.
 */
/**
 * Cubic ease-in-out for altitude interpolation during bridge segments.
 * Produces a more natural transition than linear.
 */
function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// Spline cache — avoids recomputing the expensive Steps 1-4 pipeline when
// the historical track hasn't changed between poll cycles.
// ---------------------------------------------------------------------------

type SplinedTrack = {
  key: string;
  trackPositions: [number, number][];
  resultPath: [number, number][];
  resultAltitudes: Array<number | null>;
  lastWaypointTime: number | undefined;
};

let splinedTrackCache: SplinedTrack | null = null;

export function clearSplinedTrackCache(): void {
  splinedTrackCache = null;
}

function makeTrackCacheKey(track: FlightTrack): string {
  const first = track.path[0];
  const last = track.path[track.path.length - 1];
  return `${track.icao24}|${track.startTime}|${track.endTime}|${track.path.length}|${first?.latitude?.toFixed(4)}|${last?.longitude?.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Main stitch function
// ---------------------------------------------------------------------------

export type StitchResult = {
  path: [number, number][];
  altitudes: Array<number | null>;
  valid: boolean;
};

/**
 * Stitch a historical flight track with the current live trail and live
 * position into one continuous path.
 *
 * Steps:
 * 1. Filter ground segments from historical track
 * 2. Extract and unwrap positions
 * 3. Validate track proximity to live position
 * 4. Apply Catmull-Rom spline smoothing to sparse historical waypoints
 * 5. Merge live tail with smoothed historical path
 * 6. Ensure path reaches the aircraft
 */
export function stitchHistoricalTrail(
  track: FlightTrack,
  liveTail: TrailEntry | null,
  livePosition: [number, number] | null,
  flight: FlightState | null,
  fetchedAtMs: number,
): StitchResult {
  // --- Steps 1-2 & 4: Use cached spline if the historical track is unchanged ---
  const cacheKey = makeTrackCacheKey(track);
  let trackPositions: [number, number][];
  let resultPath: [number, number][];
  let resultAltitudes: Array<number | null>;
  let lastWaypointTime: number | undefined;

  if (splinedTrackCache && splinedTrackCache.key === cacheKey) {
    // Cache hit — reuse expensive spline result, clone since Steps 5-8 mutate.
    trackPositions = splinedTrackCache.trackPositions;
    resultPath = splinedTrackCache.resultPath.map(
      (p) => [...p] as [number, number],
    );
    resultAltitudes = [...splinedTrackCache.resultAltitudes];
    lastWaypointTime = splinedTrackCache.lastWaypointTime;
  } else {
    // Cache miss — run full Steps 1-2 & 4 pipeline.

    // --- Step 1: Filter ground segments ---
    const airborneWaypoints = filterGroundSegments(track.path);
    const waypoints = airborneWaypoints ?? track.path;

    // --- Step 2: Extract and unwrap positions ---
    const rawPositions: [number, number][] = [];
    const rawAltitudes: Array<number | null> = [];

    for (const p of waypoints) {
      if (p.longitude == null || p.latitude == null) continue;
      rawPositions.push([p.longitude, p.latitude]);
      rawAltitudes.push(p.baroAltitude ?? null);
    }

    if (rawPositions.length < 2) {
      return { path: [], altitudes: [], valid: false };
    }

    // Unwrap longitudes to avoid dateline artifacts.
    trackPositions = unwrapLngPath(rawPositions);

    // --- Step 4: Apply Catmull-Rom spline smoothing ---
    const defaultAlt =
      flight?.baroAltitude ?? rawAltitudes.find((a) => a != null) ?? 0;
    const smoothedAlts = smoothAltitudeProfile([...rawAltitudes], defaultAlt);

    const elevatedWaypoints: [number, number, number][] = trackPositions.map(
      (p, i) => [p[0], p[1], smoothedAlts[i] ?? defaultAlt],
    );

    const roundedWaypoints = roundSharpCorners3D(elevatedWaypoints, 15);
    let splinedPath = catmullRomSpline3D(roundedWaypoints, 6, 28);
    splinedPath = removePathLoops(splinedPath);

    if (splinedPath.length > MAX_SPLINED_POINTS) {
      splinedPath = adaptiveDownsample(splinedPath, MAX_SPLINED_POINTS);
    }

    lastWaypointTime = waypoints[waypoints.length - 1]?.time;

    // Store in cache for next poll cycle.
    const cachedPath = splinedPath.map<[number, number]>((p) => [p[0], p[1]]);
    const cachedAlts = splinedPath.map<number | null>((p) => p[2]);
    splinedTrackCache = {
      key: cacheKey,
      trackPositions,
      resultPath: cachedPath,
      resultAltitudes: cachedAlts,
      lastWaypointTime,
    };

    // Clone for mutation in Steps 5-8.
    resultPath = cachedPath.map((p) => [...p] as [number, number]);
    resultAltitudes = [...cachedAlts];
  }

  // --- Step 3: Validate track proximity to live position ---
  const lowAltitude =
    flight && Number.isFinite(flight.baroAltitude)
      ? flight.baroAltitude! < LOW_ALTITUDE_THRESHOLD
      : false;

  const livePosAdjusted: [number, number] | null =
    livePosition && trackPositions.length > 0
      ? [
          snapLngToReference(
            livePosition[0],
            trackPositions[trackPositions.length - 1][0],
          ),
          livePosition[1],
        ]
      : livePosition;

  const nowSec = fetchedAtMs > 0 ? Math.floor(fetchedAtMs / 1000) : 0;
  const lastWaypointAgeSec =
    typeof lastWaypointTime === "number" && Number.isFinite(lastWaypointTime)
      ? Math.max(0, nowSec - lastWaypointTime)
      : 0;
  const speedMps =
    flight &&
    Number.isFinite(flight.velocity) &&
    flight.velocity! > MIN_SPEED_MPS
      ? Math.max(0, flight.velocity!)
      : DEFAULT_SPEED_MPS;
  const expectedDeg = (speedMps * lastWaypointAgeSec) / 111_320;

  if (livePosAdjusted && trackPositions.length >= 2) {
    const searchStart = Math.max(
      0,
      trackPositions.length - OVERLAP_SEARCH_WINDOW,
    );
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let i = searchStart; i < trackPositions.length; i++) {
      const p = trackPositions[i];
      const dx = p[0] - livePosAdjusted[0];
      const dy = p[1] - livePosAdjusted[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) bestDistSq = d2;
    }

    const maxRejectDeg = lowAltitude
      ? TRACK_REJECT_LOW_ALT_DEG
      : TRACK_REJECT_HIGH_ALT_DEG;
    const maxAllowedDeg = Math.min(
      maxRejectDeg,
      Math.max(lowAltitude ? 0.75 : 0.9, expectedDeg * 1.35 + 0.22),
    );

    if (bestDistSq > maxAllowedDeg * maxAllowedDeg) {
      return { path: [], altitudes: [], valid: false };
    }
  }

  let junctionCoord: [number, number] | null = null;
  let tailMerged = false;

  // --- Step 5: Merge live tail ---
  if (liveTail && liveTail.path.length >= 2) {
    const tailCount = LIVE_TAIL_POINT_COUNT;
    const start = Math.max(0, liveTail.path.length - tailCount);
    const rawTailPath = liveTail.path.slice(start);
    const tailAlt = liveTail.altitudes.slice(start);

    // Unwrap tail points relative to the historical track end.
    const tailPath: [number, number][] = [];
    let refLng =
      resultPath.length > 0
        ? resultPath[resultPath.length - 1][0]
        : rawTailPath[0][0];
    for (const [lng, lat] of rawTailPath) {
      const nextLng = snapLngToReference(lng, refLng);
      tailPath.push([nextLng, lat]);
      refLng = nextLng;
    }

    const maxConnectGapDeg = lowAltitude
      ? MAX_GAP_LOW_ALT_DEG
      : MAX_GAP_HIGH_ALT_DEG;

    const firstTail = tailPath[0];
    const searchStart = Math.max(0, resultPath.length - OVERLAP_SEARCH_WINDOW);
    let bestIndex = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (let i = searchStart; i < resultPath.length; i++) {
      const p = resultPath[i];
      const dx = p[0] - firstTail[0];
      const dy = p[1] - firstTail[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestDistSq <= MERGE_SNAP_DEG * MERGE_SNAP_DEG) {
      // Snap overlap: trim historical track and connect.
      resultPath.splice(bestIndex + 1);
      resultAltitudes.splice(bestIndex + 1);

      const join = resultPath[resultPath.length - 1];
      if (join) {
        tailPath[0] = join;
        const joinAlt = resultAltitudes[resultAltitudes.length - 1] ?? null;
        tailAlt[0] = joinAlt ?? tailAlt[0] ?? null;
      }
    } else {
      // No overlap: evaluate whether to disconnect or bridge.
      const last = resultPath[resultPath.length - 1];
      const lastAlt = resultAltitudes[resultAltitudes.length - 1] ?? null;

      if (last) {
        const dx = last[0] - firstTail[0];
        const dy = last[1] - firstTail[1];
        const gap = Math.sqrt(dx * dx + dy * dy);

        const shouldDisconnect =
          gap > HARD_DISCONNECT_GAP_DEG ||
          (lastWaypointAgeSec > STALE_DISCONNECT_AGE_SEC &&
            gap > STALE_DISCONNECT_GAP_DEG) ||
          (lastWaypointAgeSec > MODERATE_DISCONNECT_AGE_SEC &&
            gap > MODERATE_DISCONNECT_GAP_DEG);

        if (shouldDisconnect) {
          // Discard stale history, use only the live tail.
          resultPath.splice(0, resultPath.length, ...tailPath);
          resultAltitudes.splice(0, resultAltitudes.length, ...tailAlt);
          tailPath.length = 0;
          tailAlt.length = 0;
        } else {
          if (gap > maxConnectGapDeg) {
            // Gap too large to bridge — drop the tail.
            tailPath.length = 0;
          } else if (gap > CONNECT_BRIDGE_DEG) {
            // Insert a great-circle bridge with eased altitude.
            const steps = Math.max(
              BRIDGE_MIN_STEPS,
              Math.min(BRIDGE_MAX_STEPS, Math.ceil(gap / BRIDGE_STEP_SIZE_DEG)),
            );
            const firstTailAlt = tailAlt[0] ?? null;

            for (let s = 1; s < steps; s++) {
              const t = s / steps;
              const [lng, lat] = greatCircleIntermediate(
                last[0],
                last[1],
                firstTail[0],
                firstTail[1],
                t,
              );
              resultPath.push([lng, lat]);

              if (lastAlt == null && firstTailAlt == null) {
                resultAltitudes.push(null);
              } else {
                const a0 = lastAlt ?? firstTailAlt ?? 0;
                const a1 = firstTailAlt ?? lastAlt ?? a0;
                // Cubic ease for altitude bridge.
                resultAltitudes.push(a0 + (a1 - a0) * cubicEaseInOut(t));
              }
            }
          } else {
            // Small gap — snap the tail start to the track end.
            tailPath[0] = last;
            tailAlt[0] = lastAlt ?? tailAlt[0] ?? null;
          }
        }
      }
    }

    // Save the junction coordinate AFTER merge strategy selection but
    // BEFORE appending tail points.  This captures the correct boundary
    // regardless of which strategy ran (snap, bridge, small-gap snap).
    if (tailPath.length > 0 && resultPath.length > 0) {
      junctionCoord = [
        resultPath[resultPath.length - 1][0],
        resultPath[resultPath.length - 1][1],
      ];
    }

    // Append remaining tail points (skip consecutive duplicates + near-duplicates).
    for (let i = 0; i < tailPath.length; i++) {
      const pos = tailPath[i];
      const alt = tailAlt[i] ?? null;
      const last = resultPath[resultPath.length - 1];
      if (last) {
        const dx = pos[0] - last[0];
        const dy = pos[1] - last[1];
        // Skip near-duplicates (< ~10m apart) to avoid micro-segments.
        if (dx * dx + dy * dy < 0.0001 * 0.0001) continue;
      }
      resultPath.push(pos);
      resultAltitudes.push(alt);
      tailMerged = true;
    }
  }

  // --- Step 6: Ensure the trail reaches the aircraft ---
  if (livePosAdjusted) {
    const last = resultPath[resultPath.length - 1];
    if (last) {
      const dx = livePosAdjusted[0] - last[0];
      const dy = livePosAdjusted[1] - last[1];
      if (dx * dx + dy * dy > 0.0001 * 0.0001) {
        resultPath.push(livePosAdjusted);
        resultAltitudes.push(flight?.baroAltitude ?? null);
      }
    } else {
      resultPath.push(livePosAdjusted);
      resultAltitudes.push(flight?.baroAltitude ?? null);
    }
  }

  if (resultPath.length < 2) {
    return { path: [], altitudes: [], valid: false };
  }

  // --- Step 7: Remove V-shaped spikes (backtrack artifacts) ---
  const cleaned = removeSpikePoints(resultPath, resultAltitudes);

  if (cleaned.path.length < 2) {
    return { path: [], altitudes: [], valid: false };
  }

  // --- Step 8: Smooth the historical↔live junction with localized Catmull-Rom ---
  // Instead of just rounding sharp corners (roundSharpCorners3D), apply a
  // full Catmull-Rom re-spline over a window around the junction.  This
  // produces C1-continuous curvature at the merge point, eliminating the
  // visible heading kink between the smooth historical spline and the raw
  // GPS tail.
  const JUNCTION_WINDOW_BEFORE = 30;
  const JUNCTION_WINDOW_AFTER = 24;
  const MIN_JUNCTION_WINDOW = 6;

  let junctionIdx = -1;
  if (tailMerged && junctionCoord) {
    // Find the junction coordinate in the post-spike-removal array.
    // Spike removal may have shifted indices, so search the full array.
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cleaned.path.length; i++) {
      const dx = cleaned.path[i][0] - junctionCoord[0];
      const dy = cleaned.path[i][1] - junctionCoord[1];
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        junctionIdx = i;
      }
    }
    // Only accept if the match is within a reasonable distance.
    // 4× MERGE_SNAP_DEG² accounts for minor shifts from spike removal.
    if (bestDist > MERGE_SNAP_DEG * MERGE_SNAP_DEG * 4) {
      junctionIdx = -1;
    }
  }

  if (
    junctionIdx >= 0 &&
    junctionIdx < cleaned.path.length - 1 &&
    cleaned.path.length >= MIN_JUNCTION_WINDOW
  ) {
    const winStart = Math.max(0, junctionIdx - JUNCTION_WINDOW_BEFORE);
    const winEnd = Math.min(
      cleaned.path.length,
      junctionIdx + JUNCTION_WINDOW_AFTER + 1,
    );

    if (winEnd - winStart >= MIN_JUNCTION_WINDOW) {
      // Extract window as 3D points.
      const windowPoints: [number, number, number][] = [];
      for (let i = winStart; i < winEnd; i++) {
        windowPoints.push([
          cleaned.path[i][0],
          cleaned.path[i][1],
          (cleaned.altitudes[i] as number) ?? 0,
        ]);
      }

      // Use real neighbouring points as tangent anchors for correct
      // heading at the window boundaries.
      const anchorBefore: [number, number, number] =
        winStart > 0
          ? [
              cleaned.path[winStart - 1][0],
              cleaned.path[winStart - 1][1],
              (cleaned.altitudes[winStart - 1] as number) ?? 0,
            ]
          : windowPoints[0]; // fallback: mirror first point
      const anchorAfter: [number, number, number] =
        winEnd < cleaned.path.length
          ? [
              cleaned.path[winEnd][0],
              cleaned.path[winEnd][1],
              (cleaned.altitudes[winEnd] as number) ?? 0,
            ]
          : windowPoints[windowPoints.length - 1]; // fallback: mirror last

      const resplined = catmullRomRespline3D(
        anchorBefore,
        windowPoints,
        anchorAfter,
        3,
        6,
      );

      // Reconstruct the full path: prefix + re-splined junction + suffix.
      const prefix3D: [number, number, number][] = [];
      for (let i = 0; i < winStart; i++) {
        prefix3D.push([
          cleaned.path[i][0],
          cleaned.path[i][1],
          (cleaned.altitudes[i] as number) ?? 0,
        ]);
      }
      const suffix3D: [number, number, number][] = [];
      for (let i = winEnd; i < cleaned.path.length; i++) {
        suffix3D.push([
          cleaned.path[i][0],
          cleaned.path[i][1],
          (cleaned.altitudes[i] as number) ?? 0,
        ]);
      }

      const final3D = [...prefix3D, ...resplined, ...suffix3D];
      const finalPath = final3D.map<[number, number]>((p) => [p[0], p[1]]);
      const finalAlts = final3D.map<number | null>((p) => p[2]);

      return { path: finalPath, altitudes: finalAlts, valid: true };
    }
  }

  // Fallback when no junction was found (no live tail, disconnect, etc.):
  // keep sharp-corner rounding for any remaining heading discontinuities.
  const merged3D: [number, number, number][] = cleaned.path.map((p, i) => [
    p[0],
    p[1],
    (cleaned.altitudes[i] as number) ?? 0,
  ]);
  const rounded = roundSharpCorners3D(merged3D, 15);
  const finalPath = rounded.map<[number, number]>((p) => [p[0], p[1]]);
  const finalAlts = rounded.map<number | null>((p) => p[2]);

  return { path: finalPath, altitudes: finalAlts, valid: true };
}

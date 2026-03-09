/**
 * Trail stitching — merges sparse historical track data with the high-
 * frequency live trail to produce a single smooth path.
 *
 * Extracted from the ~120-line inline `mergedTrails` computation in
 * flight-tracker.tsx so the logic is testable, documented, and the
 * thresholds are named constants.
 */

import { snapLngToReference, unwrapLngPath } from "@/lib/geo";
import {
  catmullRomSpline3D,
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
const LIVE_TAIL_POINT_COUNT = 18;

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
function slerpBridge(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
  t: number,
): [number, number] {
  // For very small distances, linear interpolation is fine and avoids
  // numerical issues in the slerp formula.
  const dLng = bLng - aLng;
  const dLat = bLat - aLat;
  if (dLng * dLng + dLat * dLat < 0.01 * 0.01) {
    return [aLng + dLng * t, aLat + dLat * t];
  }

  // Convert to radians.
  const toRad = Math.PI / 180;
  const la1 = aLat * toRad;
  const lo1 = aLng * toRad;
  const la2 = bLat * toRad;
  const lo2 = bLng * toRad;

  // Great-circle angular distance.
  const dLat2 = la2 - la1;
  const dLon2 = lo2 - lo1;
  const a =
    Math.sin(dLat2 / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon2 / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (c < 1e-10) {
    return [aLng + dLng * t, aLat + dLat * t];
  }

  const sinC = Math.sin(c);
  const A = Math.sin((1 - t) * c) / sinC;
  const B = Math.sin(t * c) / sinC;

  const x =
    A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y =
    A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);

  const toDeg = 180 / Math.PI;
  return [
    Math.atan2(y, x) * toDeg,
    Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
  ];
}

/**
 * Cubic ease-in-out for altitude interpolation during bridge segments.
 * Produces a more natural transition than linear.
 */
function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
  const trackPositions = unwrapLngPath(rawPositions);
  const trackAltitudes = [...rawAltitudes];

  // --- Step 3: Validate track proximity to live position ---
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

  const lastWaypointTime = waypoints[waypoints.length - 1]?.time;
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

    const lowAltitude =
      flight && Number.isFinite(flight.baroAltitude)
        ? flight.baroAltitude! < LOW_ALTITUDE_THRESHOLD
        : false;
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

  // --- Step 4: Apply Catmull-Rom spline smoothing ---
  // Build elevated points for spline interpolation.
  const defaultAlt =
    flight?.baroAltitude ?? rawAltitudes.find((a) => a != null) ?? 0;
  const smoothedAlts = smoothAltitudeProfile(trackAltitudes, defaultAlt);

  const elevatedWaypoints: [number, number, number][] = trackPositions.map(
    (p, i) => [p[0], p[1], smoothedAlts[i] ?? defaultAlt],
  );

  // Pre-process: round sharp corners with Bézier arcs so the spline
  // doesn't overshoot into self-intersecting loops at sharp turns.
  const roundedWaypoints = roundSharpCorners3D(elevatedWaypoints, 20);

  // Apply Catmull-Rom spline to produce a smooth path.
  let splinedPath = catmullRomSpline3D(roundedWaypoints, 6, 28);

  // Safety net: detect and remove any self-intersecting loops the
  // spline may still have produced (e.g. from outlier waypoints).
  splinedPath = removePathLoops(splinedPath);

  // Downsample if the splined path is very dense.
  if (splinedPath.length > MAX_SPLINED_POINTS) {
    splinedPath = adaptiveDownsample(splinedPath, MAX_SPLINED_POINTS);
  }

  // Separate back into 2D path + altitudes for compatibility with TrailEntry.
  const resultPath: [number, number][] = splinedPath.map((p) => [p[0], p[1]]);
  const resultAltitudes: Array<number | null> = splinedPath.map((p) => p[2]);

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

    const lowAltitude =
      flight && Number.isFinite(flight.baroAltitude)
        ? flight.baroAltitude! < LOW_ALTITUDE_THRESHOLD
        : false;
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
              const [lng, lat] = slerpBridge(
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

  // --- Step 8: Round sharp corners at the historical↔live junction ---
  // The splined historical path has gentle per-point heading changes (~3-10°)
  // so roundSharpCorners3D will ONLY add arcs where there's a significant
  // heading discontinuity — typically at the merge junction or in the tail.
  const merged3D: [number, number, number][] = cleaned.path.map((p, i) => [
    p[0],
    p[1],
    (cleaned.altitudes[i] as number) ?? 0,
  ]);
  const rounded = roundSharpCorners3D(merged3D, 25);
  const finalPath = rounded.map<[number, number]>((p) => [p[0], p[1]]);
  const finalAlts = rounded.map<number | null>((p) => p[2]);

  return { path: finalPath, altitudes: finalAlts, valid: true };
}

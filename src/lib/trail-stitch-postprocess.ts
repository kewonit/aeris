/**
 * Post-processing for stitched trail paths — Steps 6-8 of the stitching pipeline.
 *
 * After the historical track and live tail have been merged (Steps 1-5),
 * this module handles:
 *   - Ensuring the trail reaches the current aircraft position (Step 6)
 *   - Safety filters for NaN/Infinity coordinates
 *   - Capping total path length
 *   - Removing V-shaped spikes and distance outliers (Step 7)
 *   - Smoothing the historical↔live junction (Step 8)
 */

import { greatCircleIntermediate } from "@/lib/geo";
import {
  removeSpikePoints,
  removeDistanceOutliers,
} from "@/lib/trail-smoothing";
import type { FlightState } from "@/lib/opensky";
import type { StitchResult } from "./trail-stitching";

// ── Constants ──────────────────────────────────────────────────────────

const CONNECT_BRIDGE_DEG = 0.15;
const BRIDGE_MAX_STEPS = 36;
const BRIDGE_MIN_STEPS = 6;
const BRIDGE_STEP_SIZE_DEG = 0.12;
const MERGE_SNAP_DEG = 0.15;
const MAX_TOTAL_PATH_POINTS = 3000;
const JUNCTION_WINDOW_BEFORE = 30;
const JUNCTION_WINDOW_AFTER = 24;
const MIN_JUNCTION_WINDOW = 6;

function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Post-processing ───────────────────────────────────────────────────

export function postprocessStitchedTrail(
  resultPath: [number, number][],
  resultAltitudes: Array<number | null>,
  tailMerged: boolean,
  junctionCoord: [number, number] | null,
  livePosAdjusted: [number, number] | null,
  flight: FlightState | null,
): StitchResult {
  // --- Step 6: Ensure the trail reaches the aircraft ---
  if (livePosAdjusted) {
    const last = resultPath[resultPath.length - 1];
    if (last) {
      const dx = livePosAdjusted[0] - last[0];
      const dy = livePosAdjusted[1] - last[1];
      const gapToAircraft = Math.sqrt(dx * dx + dy * dy);

      if (gapToAircraft > 0.0001) {
        if (!tailMerged && gapToAircraft > CONNECT_BRIDGE_DEG) {
          const steps = Math.max(
            BRIDGE_MIN_STEPS,
            Math.min(
              BRIDGE_MAX_STEPS,
              Math.ceil(gapToAircraft / BRIDGE_STEP_SIZE_DEG),
            ),
          );
          const lastAlt = resultAltitudes[resultAltitudes.length - 1] ?? null;
          const aircraftAlt = flight?.baroAltitude ?? null;

          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const [lng, lat] = greatCircleIntermediate(
              last[0],
              last[1],
              livePosAdjusted[0],
              livePosAdjusted[1],
              t,
            );
            resultPath.push([lng, lat]);

            if (lastAlt == null && aircraftAlt == null) {
              resultAltitudes.push(null);
            } else {
              const a0 = lastAlt ?? aircraftAlt ?? 0;
              const a1 = aircraftAlt ?? lastAlt ?? a0;
              resultAltitudes.push(a0 + (a1 - a0) * cubicEaseInOut(t));
            }
          }
        }
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

  // --- Safety: filter NaN/Infinity coordinates ---
  {
    let filtered = false;
    for (let i = resultPath.length - 1; i >= 0; i--) {
      const p = resultPath[i];
      if (
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1]) ||
        p[0] < -540 ||
        p[0] > 540 ||
        p[1] < -90 ||
        p[1] > 90
      ) {
        resultPath.splice(i, 1);
        resultAltitudes.splice(i, 1);
        filtered = true;
      }
    }
    if (filtered && resultPath.length < 2) {
      return { path: [], altitudes: [], valid: false };
    }
  }

  // --- Safety: cap total path length to prevent memory/perf issues ---
  if (resultPath.length > MAX_TOTAL_PATH_POINTS) {
    const stride = (resultPath.length - 1) / (MAX_TOTAL_PATH_POINTS - 1);
    const sampledPath: [number, number][] = [];
    const sampledAlt: Array<number | null> = [];
    for (let i = 0; i < MAX_TOTAL_PATH_POINTS - 1; i++) {
      const idx = Math.round(i * stride);
      sampledPath.push(resultPath[idx]);
      sampledAlt.push(resultAltitudes[idx] ?? null);
    }
    sampledPath.push(resultPath[resultPath.length - 1]);
    sampledAlt.push(resultAltitudes[resultAltitudes.length - 1] ?? null);
    resultPath.splice(0, resultPath.length, ...sampledPath);
    resultAltitudes.splice(0, resultAltitudes.length, ...sampledAlt);
  }

  // --- Step 7: Remove V-shaped spikes (backtrack artifacts) ---
  const spiked = removeSpikePoints(resultPath, resultAltitudes);

  // --- Step 7b: Remove distance outliers (MLAT artifacts, stale waypoints) ---
  const cleaned = removeDistanceOutliers(spiked.path, spiked.altitudes, 3.0);

  if (cleaned.path.length < 2) {
    return { path: [], altitudes: [], valid: false };
  }

  // --- Step 8: Smooth the historical↔live junction with box-filter ---
  // Uses a simple 0.25/0.5/0.25 weighted average instead of Catmull-Rom
  // respline to avoid creating overshoot/V-shaped artifacts at the junction.
  let junctionIdx = -1;
  if (tailMerged && junctionCoord) {
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
    if (bestDist > MERGE_SNAP_DEG * MERGE_SNAP_DEG * 4) {
      junctionIdx = -1;
    }
  }

  if (
    junctionIdx >= 0 &&
    junctionIdx < cleaned.path.length - 1 &&
    cleaned.path.length >= MIN_JUNCTION_WINDOW
  ) {
    const winStart = Math.max(1, junctionIdx - JUNCTION_WINDOW_BEFORE);
    const winEnd = Math.min(
      cleaned.path.length - 2,
      junctionIdx + JUNCTION_WINDOW_AFTER,
    );

    if (winEnd - winStart >= MIN_JUNCTION_WINDOW) {
      // Double-buffered box-filter smoothing: read from source array,
      // write to a separate buffer each pass for symmetric results.
      let path = cleaned.path.map((p) => [...p] as [number, number]);
      let alts = [...cleaned.altitudes];

      for (let pass = 0; pass < 3; pass++) {
        const nextPath = path.map((p) => [...p] as [number, number]);
        const nextAlts = [...alts];
        for (let i = winStart; i <= winEnd; i++) {
          nextPath[i] = [
            path[i - 1][0] * 0.25 + path[i][0] * 0.5 + path[i + 1][0] * 0.25,
            path[i - 1][1] * 0.25 + path[i][1] * 0.5 + path[i + 1][1] * 0.25,
          ];
          const a0 = (alts[i - 1] as number) ?? 0;
          const a1 = (alts[i] as number) ?? 0;
          const a2 = (alts[i + 1] as number) ?? 0;
          nextAlts[i] = a0 * 0.25 + a1 * 0.5 + a2 * 0.25;
        }
        path = nextPath;
        alts = nextAlts;
      }

      return { path, altitudes: alts, valid: true };
    }
  }

  // Fallback: return cleaned data as-is.
  return { path: cleaned.path, altitudes: cleaned.altitudes, valid: true };
}

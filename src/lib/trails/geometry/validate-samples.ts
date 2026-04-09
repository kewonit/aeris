import { snapLngToReference } from "@/lib/geo";

import type { TrailSnapshot } from "../types";

function isValidCoordinate(sample: TrailSnapshot): boolean {
  return (
    Number.isFinite(sample.lng) &&
    Number.isFinite(sample.lat) &&
    sample.lng >= -180 &&
    sample.lng <= 180 &&
    sample.lat >= -90 &&
    sample.lat <= 90
  );
}

/**
 * Detour ratio above which a single point is flagged as a GPS spike.
 * A ratio of 1.0 means collinear; real sharp turns rarely exceed 2.5.
 */
const SPIKE_DETOUR_RATIO = 3.0;

/**
 * Minimum perpendicular deviation (degrees) from the straight A→C line
 * before we even consider flagging the point.  Prevents removing tiny
 * micro-jitter that has no visual impact.  ~55 m at the equator.
 */
const MIN_SPIKE_DEVIATION_DEG = 0.0005;

/** Maximum number of spike-removal passes to converge multi-point spikes. */
const MAX_SPIKE_PASSES = 3;

/**
 * Remove GPS spike artefacts from a sample stream.
 *
 * For every interior point B with neighbours A and C, compute
 *   detourRatio = (dist(A,B) + dist(B,C)) / dist(A,C)
 * If the ratio exceeds {@link SPIKE_DETOUR_RATIO} and the perpendicular
 * deviation of B from line A→C exceeds {@link MIN_SPIKE_DEVIATION_DEG},
 * the point is removed.
 *
 * Runs up to {@link MAX_SPIKE_PASSES} to converge 2-point spikes
 * (removing the first reveals the second).
 */
export function filterPositionSpikes(
  samples: TrailSnapshot[],
): TrailSnapshot[] {
  let current = samples;

  for (let pass = 0; pass < MAX_SPIKE_PASSES; pass++) {
    if (current.length < 3) return current;

    const keep: boolean[] = new Array(current.length).fill(true);
    let removed = 0;

    for (let i = 1; i < current.length - 1; i++) {
      const a = current[i - 1];
      const b = current[i];
      const c = current[i + 1];

      const abDx = b.lng - a.lng;
      const abDy = b.lat - a.lat;
      const bcDx = c.lng - b.lng;
      const bcDy = c.lat - b.lat;
      const acDx = c.lng - a.lng;
      const acDy = c.lat - a.lat;

      const ab = Math.sqrt(abDx * abDx + abDy * abDy);
      const bc = Math.sqrt(bcDx * bcDx + bcDy * bcDy);
      const ac = Math.sqrt(acDx * acDx + acDy * acDy);

      // Skip degenerate cases (A ≈ C means a loop — don't remove)
      if (ac < 1e-10) continue;

      const detourRatio = (ab + bc) / ac;
      if (detourRatio > SPIKE_DETOUR_RATIO) {
        // Perpendicular distance from B to line A→C via cross-product
        const deviation = Math.abs(abDx * acDy - abDy * acDx) / ac;
        if (deviation > MIN_SPIKE_DEVIATION_DEG) {
          keep[i] = false;
          removed++;
        }
      }
    }

    if (removed === 0) break;
    current = current.filter((_, i) => keep[i]);
  }

  return current;
}

export function validateSamples(samples: TrailSnapshot[]): TrailSnapshot[] {
  if (samples.length === 0) {
    return [];
  }

  const sorted = [...samples].sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    if (left.lng !== right.lng) {
      return left.lng - right.lng;
    }
    return left.lat - right.lat;
  });

  const validated: TrailSnapshot[] = [];
  let refLng: number | null = null;

  for (const sample of sorted) {
    if (!isValidCoordinate(sample)) {
      continue;
    }

    const normalizedLng: number =
      refLng === null ? sample.lng : snapLngToReference(sample.lng, refLng);

    const normalized: TrailSnapshot = {
      ...sample,
      lng: normalizedLng,
    };

    const previous = validated[validated.length - 1];
    if (
      previous &&
      previous.timestamp === normalized.timestamp &&
      previous.lng === normalized.lng &&
      previous.lat === normalized.lat
    ) {
      if (previous.altitude == null && normalized.altitude != null) {
        validated[validated.length - 1] = normalized;
      }
      continue;
    }

    validated.push(normalized);
    refLng = normalizedLng;
  }

  return validated;
}

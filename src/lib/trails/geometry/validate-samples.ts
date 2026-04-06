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

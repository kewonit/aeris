import {
  type AircraftModelKey,
  MODEL_KEY_WINGSPAN,
} from "./aircraft-model-mapping";

export const BASE_3D_MODEL_SIZE = 18;
export const AIRCRAFT_3D_MAX_SCREEN_PIXELS = 48;

/** The widest wingspan in the model set - used as reference for max-pixel scaling. */
const MAX_WINGSPAN_M = Math.max(...Object.values(MODEL_KEY_WINGSPAN));

/**
 * Per-model full-aircraft pixel target, scaled by wingspan with sqrt compression.
 * Large aircraft (A380, 80m) use a 48px cap; smaller aircraft (Cessna, 11m)
 * cap at ~17.8px so the visual hierarchy is obvious without covering the map.
 *
 * Formula: AIRCRAFT_3D_MAX_SCREEN_PIXELS × √(wingspan / maxWingspan)
 */
export function getModelMaxPixels(key: AircraftModelKey): number {
  const wingspan = MODEL_KEY_WINGSPAN[key];
  return AIRCRAFT_3D_MAX_SCREEN_PIXELS * Math.sqrt(wingspan / MAX_WINGSPAN_M);
}

export function getModelSceneUnitPixels(
  key: AircraftModelKey,
  normalizedExtentUnits: number,
): number {
  const extent =
    Number.isFinite(normalizedExtentUnits) && normalizedExtentUnits > 0
      ? normalizedExtentUnits
      : 1;
  return getModelMaxPixels(key) / extent;
}

export function getAircraftModelZoomCompensation(currentZoom: number): number {
  if (!Number.isFinite(currentZoom)) {
    return 1;
  }
  return 1;
}

export function getAircraftScenegraphSizeScale(
  displayScale: number,
  currentZoom: number,
): number {
  return (
    BASE_3D_MODEL_SIZE *
    displayScale *
    getAircraftModelZoomCompensation(currentZoom)
  );
}

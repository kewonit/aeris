import {
  LOD_3D_ZOOM_IN,
  LOD_3D_ZOOM_OUT,
  AIRCRAFT_MAX_PIXELS,
} from "./flight-layer-constants";
import {
  type AircraftModelKey,
  MODEL_KEY_WINGSPAN,
} from "./aircraft-model-mapping";

export const BASE_3D_MODEL_SIZE = 18;

/** The widest wingspan in the model set — used as reference for max-pixel scaling. */
const MAX_WINGSPAN_M = Math.max(...Object.values(MODEL_KEY_WINGSPAN));

/**
 * Per-model maximum pixel size, scaled by wingspan with sqrt compression.
 * Large aircraft (A380, 80m) keep the current 18px cap; smaller aircraft
 * (Cessna, 11m) cap at ~6.7px so the visual hierarchy is obvious.
 *
 * Formula: AIRCRAFT_MAX_PIXELS × √(wingspan / maxWingspan)
 */
export function getModelMaxPixels(key: AircraftModelKey): number {
  const wingspan = MODEL_KEY_WINGSPAN[key];
  return AIRCRAFT_MAX_PIXELS * Math.sqrt(wingspan / MAX_WINGSPAN_M);
}

export function getAircraftModelZoomCompensation(currentZoom: number): number {
  if (!Number.isFinite(currentZoom)) {
    return 1;
  }

  const zoom = Math.max(currentZoom, LOD_3D_ZOOM_OUT);
  if (zoom >= LOD_3D_ZOOM_IN) {
    return 1;
  }

  return Math.pow(2, LOD_3D_ZOOM_IN - zoom);
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

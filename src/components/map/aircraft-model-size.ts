import { LOD_3D_ZOOM_IN, LOD_3D_ZOOM_OUT } from "./flight-layer-constants";

export const BASE_3D_MODEL_SIZE = 18;

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

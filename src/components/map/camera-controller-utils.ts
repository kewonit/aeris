import type maplibregl from "maplibre-gl";

export const FPV_MODE_SWITCH_DURATION_MS = 700;
export const FPV_DISTANCE_ZOOM_OFFSET = 1.1;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function normalizeLng(lng: number): number {
  return ((lng + 540) % 360) - 180;
}

export function lerpLng(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return normalizeLng(from + delta * t);
}

export function fpvZoomForAltitude(altMeters: number): number {
  const alt = Math.max(altMeters, 0);
  if (alt < 50) return 16.2;
  const zoom = 18.1 - 2.0 * Math.log10(Math.max(alt, 50));
  return Math.max(10.1, Math.min(16.2, zoom));
}

export function setMapInteractionsEnabled(
  map: maplibregl.Map,
  enabled: boolean,
): void {
  if (enabled) {
    map.dragPan.enable();
    map.dragRotate.enable();
    map.scrollZoom.enable();
    map.touchZoomRotate.enable();
    map.doubleClickZoom.enable();
    map.keyboard.enable();
    return;
  }

  map.dragPan.disable();
  map.dragRotate.disable();
  map.scrollZoom.disable();
  map.touchZoomRotate.disable();
  map.doubleClickZoom.disable();
  map.keyboard.disable();
}

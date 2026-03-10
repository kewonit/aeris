import maplibregl from "maplibre-gl";

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
  if (!Number.isFinite(altMeters)) return 12;
  const alt = Math.max(altMeters, 0);
  if (alt < 50) return 16.2;
  const zoom = 18.1 - 2.0 * Math.log10(Math.max(alt, 50));
  return Math.max(10.1, Math.min(16.2, zoom));
}

/**
 * Project a geographic position at a given elevation to a screen‐space
 * pixel offset from the map's visual centre.
 *
 * Uses MapLibre's internal transform.locationToScreenPoint with a synthetic
 * terrain provider so the correct projection (Globe, Mercator, or the
 * automatic transition between them) handles elevation natively.
 *
 * There is no public MapLibre API for elevation-aware screen projection
 * (map.project() is 2D only). This internal access is tested against
 * MapLibre GL JS v5.18.x. A public-API fallback (without elevation) is
 * provided for resilience against future internal refactors.
 */
export function projectLngLatElevationPixelDelta(
  map: maplibregl.Map,
  lng: number,
  lat: number,
  elevationMeters: number,
): { dx: number; dy: number } | null {
  // MapLibre's transform has separate Globe and Mercator implementations of
  // locationToScreenPoint(lnglat, terrain). Both support elevation when a
  // terrain-like provider is supplied:
  //   Mercator: coordinatePoint(coord, elevation, _pixelMatrix3D)
  //   Globe:    scales surface point by (1 + elevation/earthRadius), then projects
  // By providing a duck-typed provider that returns our altitude, we get
  // elevation-aware projection in every mode without touching internals.
  type TransformLike = {
    locationToScreenPoint: (
      lnglat: maplibregl.LngLat,
      terrain: unknown,
    ) => { x: number; y: number };
  };

  const tr = (map as unknown as { transform?: TransformLike }).transform;

  const canvas = map.getCanvas();
  const cx = canvas.clientWidth / 2;
  const cy = canvas.clientHeight / 2;

  // Try elevation-aware internal API first
  if (tr && typeof tr.locationToScreenPoint === "function") {
    const fakeTerrain = {
      getElevationForLngLat: () => elevationMeters,
      getElevationForLngLatZoom: () => elevationMeters,
    };

    try {
      const lnglat = new maplibregl.LngLat(lng, lat);
      const screenPt = tr.locationToScreenPoint(lnglat, fakeTerrain);

      if (Number.isFinite(screenPt.x) && Number.isFinite(screenPt.y)) {
        return { dx: screenPt.x - cx, dy: screenPt.y - cy };
      }
    } catch {
      // Point may be behind the globe horizon — fall through to public API
    }
  }

  // Fallback: public map.project() without elevation awareness.
  // This gives correct 2D placement but ignores altitude offset.
  try {
    const projected = map.project(new maplibregl.LngLat(lng, lat));
    if (Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
      return { dx: projected.x - cx, dy: projected.y - cy };
    }
  } catch {
    // Point may be behind the globe horizon
  }

  return null;
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

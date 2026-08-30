import maplibregl from "maplibre-gl";

export const FPV_CAMERA_PITCH = 80;
export const FPV_DEFAULT_ALTITUDE_METERS = 5_000;
export const FPV_MIN_CAMERA_ALTITUDE_METERS = 60;

const MAX_MERCATOR_LATITUDE = 85.051129;

export type FpvCameraPosition = {
  lng: number;
  lat: number;
  alt: number;
  track: number | null;
};

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function normalizeLng(lng: number): number {
  return ((lng + 540) % 360) - 180;
}

export function normalizeBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

export function fpvCameraOptions(
  map: maplibregl.Map,
  position: FpvCameraPosition,
  fallbackBearing: number,
): maplibregl.CameraOptions | null {
  if (
    !Number.isFinite(position.lng) ||
    !Number.isFinite(position.lat) ||
    Math.abs(position.lat) > 90
  ) {
    return null;
  }

  const latitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, position.lat),
  );
  const altitude = Number.isFinite(position.alt)
    ? Math.max(position.alt, FPV_MIN_CAMERA_ALTITUDE_METERS)
    : FPV_DEFAULT_ALTITUDE_METERS;
  const bearing = normalizeBearing(
    position.track !== null && Number.isFinite(position.track)
      ? position.track
      : fallbackBearing,
  );

  try {
    return map.calculateCameraOptionsFromCameraLngLatAltRotation(
      new maplibregl.LngLat(normalizeLng(position.lng), latitude),
      altitude,
      bearing,
      FPV_CAMERA_PITCH,
      0,
    );
  } catch {
    return null;
  }
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
    centerPoint?: { x: number; y: number };
  };

  const tr = (map as unknown as { transform?: TransformLike }).transform;

  const canvas = map.getCanvas();
  const centerPoint = tr?.centerPoint;
  const centerX = centerPoint?.x;
  const centerY = centerPoint?.y;
  const cx =
    typeof centerX === "number" && Number.isFinite(centerX)
      ? centerX
      : canvas.clientWidth / 2;
  const cy =
    typeof centerY === "number" && Number.isFinite(centerY)
      ? centerY
      : canvas.clientHeight / 2;

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
      // Point may be behind the globe horizon - fall through to public API
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

export function centerLngLatForScreenOffset(
  map: maplibregl.Map,
  lng: number,
  lat: number,
  offset: [number, number],
): [number, number] | null {
  type TransformLike = {
    center: maplibregl.LngLat;
    centerPoint: { x: number; y: number };
    clone: () => TransformLike;
    setLocationAtPoint: (
      lnglat: maplibregl.LngLat,
      point: maplibregl.Point,
    ) => void;
  };

  const transform = (map as unknown as { transform?: TransformLike }).transform;
  if (!transform || typeof transform.clone !== "function") return null;

  try {
    const clone = transform.clone();
    clone.setLocationAtPoint(
      new maplibregl.LngLat(lng, lat),
      new maplibregl.Point(
        clone.centerPoint.x + offset[0],
        clone.centerPoint.y + offset[1],
      ),
    );

    const center = clone.center;
    if (!Number.isFinite(center.lng) || !Number.isFinite(center.lat)) {
      return null;
    }

    return [center.lng, center.lat];
  } catch {
    return null;
  }
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

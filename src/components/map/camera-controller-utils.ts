import maplibregl from "maplibre-gl";
import { normalizeBearing } from "./flight-interpolation";

export const DEFAULT_ZOOM = 9.2;
export const DEFAULT_PITCH = 49;
export const DEFAULT_BEARING = 27.4;
/** Leaving first person eases out to the overview over as long as entering. */
export const FPV_EXIT_DURATION_MS = 1_100;

const MAX_MERCATOR_LATITUDE = 85.051129;
/** Drawn heights above this share of the camera's height cannot be framed. */
const FRAMABLE_CAMERA_SHARE = 0.95;

/**
 * Where the map goes when first person view ends, however it ends: the
 * default overview, centred on the aircraft. The open card's position is
 * the aircraft's latest; without a card, where the camera last saw it is.
 */
export function fpvExitCamera({
  panelCoordinates,
  cockpit,
  padding,
  reduceMotion,
}: {
  panelCoordinates: [number, number] | null;
  cockpit: [number, number];
  padding: maplibregl.PaddingOptions;
  reduceMotion: boolean;
}): maplibregl.EaseToOptions {
  return {
    center: panelCoordinates ?? cockpit,
    zoom: DEFAULT_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
    padding,
    duration: reduceMotion ? 0 : FPV_EXIT_DURATION_MS,
    essential: true,
  };
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function normalizeLng(lng: number): number {
  return ((lng + 540) % 360) - 180;
}

/**
 * Whether an aircraft drawn at this height can be framed by moving the map.
 * At or near the camera's own height the projection flips, so recentring on
 * it would send the map somewhere wrong.
 */
export function isWellBelowCamera(
  elevationMeters: number,
  cameraHeightMeters: number,
): boolean {
  return elevationMeters < FRAMABLE_CAMERA_SHARE * cameraHeightMeters;
}


/**
 * The camera looks down at the aircraft by this much, and its pitch leaves
 * the aircraft a few degrees below the centre of the view, so the way ahead
 * fills most of it.
 */
const FOLLOW_LOOK_DOWN_DEG = 25;
export const FPV_FOLLOW_PITCH = 68;
/** The camera never comes closer than this, so the aircraft stays a model... */
const MIN_FOLLOW_METERS = 300;
/** ...nor further than this, so the ground stays readable from cruise. */
const MAX_FOLLOW_METERS = 4_000;
/** The follow distance grows by this much per metre of height. */
const FOLLOW_PER_HEIGHT = 0.25;
const METERS_PER_DEGREE = 111_320;

/**
 * How far behind the aircraft the camera follows, from the height it is
 * drawn at: close on an approach, where the runway and buildings matter,
 * further back at cruise, where the landscape does.
 */
export function fpvFollowDistanceMeters(drawnHeightMeters: number): number {
  const height = Number.isFinite(drawnHeightMeters)
    ? Math.max(0, drawnHeightMeters)
    : 0;
  return Math.min(
    MAX_FOLLOW_METERS,
    MIN_FOLLOW_METERS + FOLLOW_PER_HEIGHT * height,
  );
}

/** The aircraft the camera follows: where it is drawn, and its track. */
export type FpvFollowTarget = {
  lng: number;
  lat: number;
  /** Metres above the map. */
  elevation: number;
  /** Degrees, or null until a track is reported. */
  track: number | null;
};

/**
 * The camera behind and above the aircraft, looking along its track. It sits
 * back along the track and up from the aircraft by the follow distance, at
 * the look-down angle, so the aircraft is always framed the same way for
 * its height. MapLibre turns the camera's own position into the map's
 * centre and zoom; at this pitch the ground is always in front of it.
 *
 * @param fallbackBearing Used until the aircraft reports a track.
 */
export function fpvFollowCamera(
  map: maplibregl.Map,
  target: FpvFollowTarget,
  fallbackBearing: number,
): maplibregl.CameraOptions | null {
  if (
    !Number.isFinite(target.lng) ||
    !Number.isFinite(target.lat) ||
    Math.abs(target.lat) > 90
  ) {
    return null;
  }

  const bearing = normalizeBearing(
    target.track !== null && Number.isFinite(target.track)
      ? target.track
      : fallbackBearing,
  );
  const elevation = Number.isFinite(target.elevation)
    ? Math.max(0, target.elevation)
    : 0;
  const distance = fpvFollowDistanceMeters(elevation);
  const lookDown = (FOLLOW_LOOK_DOWN_DEG * Math.PI) / 180;
  const back = distance * Math.cos(lookDown);
  const up = distance * Math.sin(lookDown);
  const radians = (bearing * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((target.lat * Math.PI) / 180), 1e-6);
  const lng =
    target.lng - (back * Math.sin(radians)) / (METERS_PER_DEGREE * cosLat);
  const lat = target.lat - (back * Math.cos(radians)) / METERS_PER_DEGREE;
  const latitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, lat),
  );

  try {
    return map.calculateCameraOptionsFromCameraLngLatAltRotation(
      new maplibregl.LngLat(normalizeLng(lng), latitude),
      elevation + up,
      bearing,
      FPV_FOLLOW_PITCH,
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

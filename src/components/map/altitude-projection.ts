import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";

import { metersPerPixel } from "./aircraft-size";
import {
  GLOBE_FADE_ZOOM_CEIL,
  TRAIL_BELOW_AIRCRAFT_METERS,
} from "./flight-layer-constants";

const LOW_ALT_BREAK_M = 3_000;
const MID_ALT_BREAK_M = 9_000;
const LOW_ALT_SCALE = 3.0;
const MID_ALT_SCALE = 2.5;
const HIGH_ALT_SCALE = 2.0;
const MIN_DISPLAY_ALTITUDE_METERS = 60;
const FULL_ELEVATION_SCALE_ZOOM = 6.9;
/** The camera sits this many viewport heights from the centre of the map. */
const CAMERA_DISTANCE_VIEWPORT_HEIGHTS = 1.5;
/** From this zoom in, the height ceiling comes down with the camera. */
const CEILING_ZOOM = 10.5;
/** The ceiling's share of the camera's height there. */
const CEILING_CAMERA_SHARE = 0.45;
/**
 * Tilted further, the camera looks out towards the horizon, where high
 * traffic is seen against the sky, so the ceiling stops coming down.
 */
const CEILING_MAX_PITCH = 60;
/** Heights above this share of the ceiling are eased towards it. */
const CEILING_EASE_SHARE = 0.45;

const ELEVATION_SCALE_PROFILE: Record<
  AltitudeDisplayMode,
  {
    hidden: number;
    visible: number;
    city: number;
  }
> = {
  realistic: {
    hidden: 0.28,
    visible: 0.88,
    city: 1,
  },
  presentation: {
    hidden: 0.34,
    visible: 0.96,
    city: 1.8,
  },
};

export function getZoomAdjustedElevationScale(
  currentZoom: number,
  mode: AltitudeDisplayMode = "presentation",
): number {
  const profile = ELEVATION_SCALE_PROFILE[mode];
  if (!Number.isFinite(currentZoom)) return profile.city;

  const zoom = Math.max(0, currentZoom);
  if (zoom >= FULL_ELEVATION_SCALE_ZOOM) {
    return profile.city;
  }

  if (zoom <= GLOBE_FADE_ZOOM_CEIL) {
    const t = zoom / GLOBE_FADE_ZOOM_CEIL;
    return profile.hidden + (profile.visible - profile.hidden) * t;
  }

  const t =
    (zoom - GLOBE_FADE_ZOOM_CEIL) /
    (FULL_ELEVATION_SCALE_ZOOM - GLOBE_FADE_ZOOM_CEIL);
  return profile.visible + (profile.city - profile.visible) * t;
}

export function projectDisplayedAltitudeMeters(
  altitude: number | null,
  mode: AltitudeDisplayMode = "presentation",
): number {
  if (altitude === null || !Number.isFinite(altitude)) return 0;

  const value = Math.max(0, altitude);
  if (mode === "realistic") {
    return value;
  }

  if (value <= LOW_ALT_BREAK_M) {
    return Math.max(MIN_DISPLAY_ALTITUDE_METERS, value * LOW_ALT_SCALE);
  }

  if (value <= MID_ALT_BREAK_M) {
    return (
      LOW_ALT_BREAK_M * LOW_ALT_SCALE +
      (value - LOW_ALT_BREAK_M) * MID_ALT_SCALE
    );
  }

  return (
    LOW_ALT_BREAK_M * LOW_ALT_SCALE +
    (MID_ALT_BREAK_M - LOW_ALT_BREAK_M) * MID_ALT_SCALE +
    (value - MID_ALT_BREAK_M) * HIGH_ALT_SCALE
  );
}

export function projectTrailElevationMeters(
  altitude: number | null,
  mode: AltitudeDisplayMode = "presentation",
): number {
  const displayed = projectDisplayedAltitudeMeters(altitude, mode);
  if (displayed <= 0) return 0;
  return Math.max(0, displayed - TRAIL_BELOW_AIRCRAFT_METERS);
}

/** How high the camera is above the ground, in metres. */
export function cameraHeightMeters(
  zoom: number,
  latitude: number,
  viewportHeight: number,
  pitch: number,
): number {
  return (
    CAMERA_DISTANCE_VIEWPORT_HEIGHTS *
    viewportHeight *
    metersPerPixel(zoom, latitude) *
    Math.cos((pitch * Math.PI) / 180)
  );
}

/**
 * The height no aircraft is drawn above, in metres. Zoomed in, the camera
 * comes down below exaggerated cruising heights, and aircraft drawn near or
 * above it leave the view. From CEILING_ZOOM in, the ceiling keeps them in
 * the lower part of the view; zoomed further out it rises faster than the
 * camera, so the overview keeps its full heights.
 */
export function heightCeilingMeters(
  zoom: number,
  latitude: number,
  viewportHeight: number,
  pitch: number,
): number {
  return (
    CEILING_CAMERA_SHARE *
    cameraHeightMeters(
      zoom,
      latitude,
      viewportHeight,
      Math.min(pitch, CEILING_MAX_PITCH),
    ) *
    Math.max(1, 2 ** (CEILING_ZOOM - zoom))
  );
}

/**
 * Eases a drawn height under the ceiling. Lower heights are unchanged, and
 * eased ones keep their order, so climbing traffic still rises.
 */
export function elevationUnderCeiling(
  elevation: number,
  ceiling: number,
): number {
  const start = CEILING_EASE_SHARE * ceiling;
  if (!(elevation > start)) return elevation;
  const room = ceiling - start;
  const excess = elevation - start;
  return start + (room * excess) / (excess + room);
}

/** How high an aircraft is drawn, in metres. */
export function aircraftElevationMeters(
  altitude: number | null,
  mode: AltitudeDisplayMode,
  elevScale: number,
  heightCeiling: number,
): number {
  return elevationUnderCeiling(
    projectDisplayedAltitudeMeters(altitude, mode) * elevScale,
    heightCeiling,
  );
}

/** How high a trail is drawn, in metres: just below its aircraft. */
export function trailElevationMeters(
  altitude: number | null,
  mode: AltitudeDisplayMode,
  elevScale: number,
  heightCeiling: number,
): number {
  return elevationUnderCeiling(
    Math.max(0, projectTrailElevationMeters(altitude, mode) * elevScale),
    heightCeiling,
  );
}

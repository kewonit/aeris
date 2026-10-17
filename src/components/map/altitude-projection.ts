import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";

import { metersPerPixel } from "./aircraft-size";

const LOW_ALT_BREAK_M = 3_000;
const MID_ALT_BREAK_M = 9_000;
const LOW_ALT_SCALE = 3.0;
const MID_ALT_SCALE = 2.5;
const HIGH_ALT_SCALE = 2.0;
const MIN_DISPLAY_ALTITUDE_METERS = 60;
/** The camera sits this many viewport heights from the centre of the map. */
const CAMERA_DISTANCE_VIEWPORT_HEIGHTS = 1.5;

/**
 * The extra stretch on projected heights. It never depends on zoom: a
 * height that changed as the camera moved would make aircraft drift and bob
 * while zooming.
 */
const ELEVATION_SCALE: Record<AltitudeDisplayMode, number> = {
  realistic: 1,
  presentation: 1.8,
};

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
 * How high an aircraft, or its trail, is drawn, in metres. A trail rides at
 * its aircraft's own height so it runs level into the tail.
 *
 * @param offsetMeters Added to the altitude first. First person view uses
 *   it to sit heights above the local ground (fpv-height); elsewhere it is 0.
 */
export function aircraftElevationMeters(
  altitude: number | null,
  mode: AltitudeDisplayMode,
  offsetMeters = 0,
): number {
  const shifted = altitude === null ? null : altitude + offsetMeters;
  return projectDisplayedAltitudeMeters(shifted, mode) * ELEVATION_SCALE[mode];
}

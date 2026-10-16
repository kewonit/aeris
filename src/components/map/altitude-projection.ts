import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";

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

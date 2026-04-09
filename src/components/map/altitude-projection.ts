import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";

import { TRAIL_BELOW_AIRCRAFT_METERS } from "./flight-layer-constants";

const LOW_ALT_BREAK_M = 3_000;
const MID_ALT_BREAK_M = 9_000;
const LOW_ALT_SCALE = 1.46;
const MID_ALT_SCALE = 1.26;
const HIGH_ALT_SCALE = 1.1;
const MIN_DISPLAY_ALTITUDE_METERS = 60;

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

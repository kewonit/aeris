import type { FlightState } from "@/lib/opensky";

import {
  MODEL_KEY_WINGSPAN,
  resolveModelKeyCached,
} from "./aircraft-model-mapping";

/** Metres per pixel at zoom 0 on the equator, with deck's 512 px tiles. */
const METERS_PER_PIXEL_AT_ZOOM_0 = 78_271.517;

/**
 * Share of an aircraft's footprint from its centre back to its tail.
 * Models are scaled so their footprint is the larger of wingspan and
 * length, and length is close to wingspan for most aircraft.
 */
export const TAIL_OFFSET_SHARE = 0.45;

// Wingspans in metres, from manufacturer specs, for types where the class
// model's wingspan is a poor fit.
const TYPE_WINGSPAN_OVERRIDE: Readonly<Record<string, number>> = {
  // ── Boeing 757 (narrowbody model, wider than B737/A320) ──────────
  B752: 38,
  B753: 38,
  // ── Boeing 767 (widebody-2eng but smaller than B777) ─────────────
  B762: 48,
  B763: 48,
  B764: 52,
  // ── Boeing 787 ───────────────────────────────────────────────────
  B788: 60,
  B789: 60,
  B78X: 60,
  // ── Boeing 777 ───────────────────────────────────────────────────
  B772: 61,
  B773: 61,
  B77L: 65,
  B77W: 65,
  B778: 72,
  B779: 72,
  // ── Boeing 747 ───────────────────────────────────────────────────
  B741: 60,
  B742: 60,
  B743: 60,
  B744: 64,
  B748: 68,
  B74S: 60,
  // ── Airbus widebodies ────────────────────────────────────────────
  A30B: 45,
  A306: 45,
  A310: 44,
  A332: 60,
  A333: 60,
  A338: 64,
  A339: 64,
  A342: 60,
  A343: 60,
  A345: 64,
  A346: 64,
  A359: 65,
  A35K: 65,
  // ── Regional jets - CRJ vs Embraer ───────────────────────────────
  CRJ1: 21,
  CRJ2: 21,
  CRJ7: 23,
  CRJ9: 25,
  CRJX: 26,
  E170: 26,
  E75S: 26,
  E75L: 26,
  E190: 29,
  E195: 29,
  E290: 34,
  E295: 35,
  E135: 20,
  E145: 20,
  E35L: 20,
  E45X: 20,
  // ── Turboprops ───────────────────────────────────────────────────
  DH8D: 28,
  AT76: 27,
  AT72: 27,
  DH8A: 26,
  DH8B: 26,
  DH8C: 27,
  AT43: 25,
  AT45: 25,
  SF34: 21,
  JS41: 18,
  // ── Larger business jets ─────────────────────────────────────────
  GLEX: 29,
  GL5T: 29,
  GL7T: 30,
  GLF5: 29,
  GLF6: 30,
  // ── Smaller business jets ────────────────────────────────────────
  LJ35: 12,
  LJ45: 15,
  LJ60: 13,
  C56X: 16,
  C560: 16,
  C680: 19,
  C68A: 22,
  C700: 20,
  E55P: 16,
  E50P: 12,
  // ── Russian / military widebodies ────────────────────────────────
  IL76: 51,
  IL96: 60,
  A124: 73,
  AN22: 64,
  C17: 52,
  C5M: 68,
  KC10: 50,
  K35R: 40,
};

export type AircraftScreenSize = {
  /** Width in pixels, as if the aircraft sat at ground level. */
  footprintPx: number;
  /** How much perspective enlarges the aircraft at its drawn height. */
  magnification: number;
};

export function metersPerPixel(zoom: number, latitude: number): number {
  return (
    (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) /
    2 ** zoom
  );
}

export function aircraftWingspanMeters(flight: FlightState): number {
  const override = flight.typeCode
    ? TYPE_WINGSPAN_OVERRIDE[flight.typeCode.toUpperCase()]
    : undefined;
  return override ?? MODEL_KEY_WINGSPAN[resolveModelKeyCached(flight)];
}

/**
 * How wide an aircraft is drawn, in pixels at ground level. Sizes grow
 * gently with wingspan, so a big jet stays in proportion with a light
 * aircraft instead of dwarfing it, and shrink a little when zoomed out.
 * Zoomed in far enough, the aircraft is drawn at its real size.
 */
export function aircraftFootprintPixels(
  wingspanMeters: number,
  zoom: number,
  latitude: number,
): number {
  if (!Number.isFinite(zoom)) {
    return 14 + 0.2 * wingspanMeters;
  }
  const zoomFactor = Math.min(1, Math.max(0.75, 0.75 + (zoom - 6) * 0.0625));
  const floor = (14 + 0.2 * wingspanMeters) * zoomFactor;
  return Math.max(floor, wingspanMeters / metersPerPixel(zoom, latitude));
}

/**
 * The most perspective compensation applied to one aircraft. Zoomed in,
 * exaggerated cruise heights reach the camera itself, where enlargement
 * grows without bound.
 */
const MAX_MAGNIFICATION = 40;

/**
 * How much larger perspective draws something at `elevation` metres than
 * the same thing on the ground below it. Altitudes are exaggerated on the
 * map, which puts high aircraft close to the camera; dividing their size
 * by this keeps every aircraft at its ground-level size.
 */
export function altitudeMagnification(
  project: (position: [number, number, number]) => number[],
  longitude: number,
  latitude: number,
  elevation: number,
): number {
  if (!(elevation > 0)) return 1;

  const step = 0.001;
  const span = (z: number) => {
    const origin = project([longitude, latitude, z]);
    const east = project([longitude + step, latitude, z]);
    const north = project([longitude, latitude + step, z]);
    return (
      Math.hypot(east[0] - origin[0], east[1] - origin[1]) +
      Math.hypot(north[0] - origin[0], north[1] - origin[1])
    );
  };

  const ratio = span(elevation) / span(0);
  return Number.isFinite(ratio)
    ? Math.min(MAX_MAGNIFICATION, Math.max(1, ratio))
    : 1;
}

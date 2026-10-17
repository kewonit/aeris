import type { FlightState } from "@/lib/opensky";

import {
  type AircraftModelKey,
  MODEL_KEY_WINGSPAN,
  resolveModelKeyCached,
} from "./aircraft-model-mapping";

/** Metres per pixel at zoom 0 on the equator, with deck's 512 px tiles. */
const METERS_PER_PIXEL_AT_ZOOM_0 = 78_271.517;

/**
 * Share of an aircraft's footprint from its centre back to its tail, for
 * 2D icons and for 3D models that have not loaded yet.
 */
const DEFAULT_TAIL_SHARE = 0.4;

const modelTailShares = new Map<AircraftModelKey, number>();

/** Records where a loaded model's tail sits, measured from its geometry. */
export function recordModelTailShare(key: AircraftModelKey, share: number) {
  modelTailShares.set(key, share);
}

/** Share of the drawn footprint from an aircraft's centre to its tail. */
export function aircraftTailShare(flight: FlightState, model: boolean) {
  if (!model) return DEFAULT_TAIL_SHARE;
  return (
    modelTailShares.get(resolveModelKeyCached(flight)) ?? DEFAULT_TAIL_SHARE
  );
}

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
  B350: 18,
  BE20: 17,
  BE9L: 15,
  BE9T: 15,
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
  /** Share of the footprint from the centre back to the tail. */
  tailShare: number;
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

/** At this zoom and above, aircraft are drawn at their full symbol size. */
const FULL_SIZE_ZOOM = 10;
/** The share of that size an aircraft loses for each zoom level out... */
const SHRINK_PER_ZOOM = 0.1;
/** ...down to this share, so a zoomed-out busy sky does not turn solid. */
const MIN_SIZE_SHARE = 0.35;

/**
 * How wide an aircraft is drawn, in pixels at ground level. Sizes grow
 * gently with wingspan, so a big jet stays in proportion with a light
 * aircraft instead of dwarfing it, and shrink steadily as the map zooms
 * out. Zoomed in far enough, the aircraft is drawn at its real size.
 */
export function aircraftFootprintPixels(
  wingspanMeters: number,
  zoom: number,
  latitude: number,
): number {
  if (!Number.isFinite(zoom)) {
    return 14 + 0.2 * wingspanMeters;
  }
  const zoomFactor = Math.min(
    1,
    Math.max(MIN_SIZE_SHARE, 1 - (FULL_SIZE_ZOOM - zoom) * SHRINK_PER_ZOOM),
  );
  const floor = (14 + 0.2 * wingspanMeters) * zoomFactor;
  return Math.max(floor, wingspanMeters / metersPerPixel(zoom, latitude));
}

/** Seen from the cockpit, no aircraft looks smaller than this, so far traffic stays a dot... */
const FPV_MIN_APPARENT_PX = 4;
/** ...or larger than this, so a near pass does not fill the screen. */
const FPV_MAX_APPARENT_PX = 160;

/**
 * An aircraft's size from the cockpit, in pixels at the depth of the map's
 * centre, which is the unit models and icons are drawn in; perspective then
 * shrinks it with distance. It is the aircraft's real wingspan, kept between
 * a visible dot and a screen-filling size at its distance.
 *
 * @param focalPx The camera's focal length in pixels: half the canvas height
 *   over the tangent of half the vertical field of view.
 */
export function fpvFootprintPixels(
  wingspanMeters: number,
  distanceMeters: number,
  focalPx: number,
  metersPerPixelAtCenter: number,
): number {
  // The width, in metres, that looks a given number of pixels wide here.
  const metersFor = (pixels: number) => (pixels * distanceMeters) / focalPx;
  const meters = Math.min(
    Math.max(wingspanMeters, metersFor(FPV_MIN_APPARENT_PX)),
    metersFor(FPV_MAX_APPARENT_PX),
  );
  return meters / metersPerPixelAtCenter;
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
 *
 * Measured with a step across the view, which perspective scales by depth
 * alone; a step along the view is also foreshortened by the pitch.
 */
export function altitudeMagnification(
  project: (position: [number, number, number]) => number[],
  longitude: number,
  latitude: number,
  elevation: number,
  bearing: number,
): number {
  if (!(elevation > 0)) return 1;

  const step = 0.001;
  const radians = (bearing * Math.PI) / 180;
  const stepLng =
    (step * Math.cos(radians)) / Math.cos((latitude * Math.PI) / 180);
  const stepLat = -step * Math.sin(radians);
  const span = (z: number) => {
    const origin = project([longitude, latitude, z]);
    const across = project([longitude + stepLng, latitude + stepLat, z]);
    return Math.hypot(across[0] - origin[0], across[1] - origin[1]);
  };

  const ratio = span(elevation) / span(0);
  return Number.isFinite(ratio)
    ? Math.min(MAX_MAGNIFICATION, Math.max(1, ratio))
    : 1;
}

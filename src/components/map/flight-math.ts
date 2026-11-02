import type { Snapshot } from "./flight-layer-constants";

// ── Interpolation Math ─────────────────────────────────────────────────

/**
 * The signed turn from `a` to `b` the short way round, -180 to 180, for
 * any inputs, including angles past 360 or below 0.
 */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

// ── Distance Helpers ───────────────────────────────────────────────────

export function horizontalDistanceFromLngLat(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const avgLatRad = ((aLat + bLat) * 0.5 * Math.PI) / 180;
  const metersPerDegLon = 111_320 * Math.max(0.2, Math.cos(avgLatRad));
  // The short way round, so a step across the 180th meridian stays short.
  const dx = (((((bLng - aLng) % 360) + 540) % 360) - 180) * metersPerDegLon;
  const dy = (bLat - aLat) * 111_320;
  return Math.hypot(dx, dy);
}

export function horizontalDistanceMeters(a: Snapshot, b: Snapshot): number {
  return horizontalDistanceFromLngLat(a.lng, a.lat, b.lng, b.lat);
}

"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  centerLngLatForScreenOffset,
  DEFAULT_ZOOM,
  projectLngLatElevationPixelDelta,
} from "./camera-controller-utils";
import { cameraHeightMeters } from "./altitude-projection";
import type { FpvDrawnPosition } from "./flight-layer-constants";

/** Following from further out than this first brings the aircraft closer. */
const FOLLOW_MIN_ZOOM = 7.5;
const FOLLOW_ENTRY_MS = 900;
/**
 * The camera stays at least this many times the aircraft's drawn height
 * above the ground, so a high aircraft is seen from above, not beside.
 */
const CAMERA_HEADROOM = 2.5;
/** Below this, a move is too small to be worth a camera update. */
const MOVE_EPSILON_DEG = 1e-7;

/** Gestures that take the camera back from the follow. */
const PAN_EVENTS = ["dragstart"] as const;

/**
 * The closest zoom that keeps the camera well above the aircraft as drawn,
 * and no closer than the map's usual city view.
 */
function followZoom(map: maplibregl.Map, drawn: FpvDrawnPosition): number {
  const zoom = map.getZoom();
  const height = cameraHeightMeters(
    zoom,
    drawn.lat,
    map.getCanvas().clientHeight,
    map.getPitch(),
  );
  const needed = drawn.elevation * CAMERA_HEADROOM;
  if (!(height > 0) || needed <= 0) return DEFAULT_ZOOM;
  return Math.min(DEFAULT_ZOOM, zoom - Math.log2(needed / height));
}

/**
 * Where to put the map's center so the aircraft, drawn above its ground
 * position, sits in the middle of the view.
 */
function centerForDrawn(
  map: maplibregl.Map,
  drawn: FpvDrawnPosition,
): [number, number] {
  if (drawn.elevation <= 0) return [drawn.lng, drawn.lat];
  const elevated = projectLngLatElevationPixelDelta(
    map,
    drawn.lng,
    drawn.lat,
    drawn.elevation,
  );
  const ground = projectLngLatElevationPixelDelta(map, drawn.lng, drawn.lat, 0);
  if (!elevated || !ground) return [drawn.lng, drawn.lat];
  const canvas = map.getCanvas();
  const limit = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.45;
  const clamp = (value: number) => Math.max(-limit, Math.min(limit, value));
  return (
    centerLngLatForScreenOffset(map, drawn.lng, drawn.lat, [
      clamp(-(elevated.dx - ground.dx)),
      clamp(-(elevated.dy - ground.dy)),
    ]) ?? [drawn.lng, drawn.lat]
  );
}

/**
 * Keeps the followed aircraft in the middle of the map, frame by frame,
 * where it is drawn. The camera keeps the bearing and pitch the user chose:
 * zooming and turning the map are still the user's, and panning away ends
 * the follow.
 */
export function useFollowCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  followIcao24: string | null,
  drawnRef: MutableRefObject<FpvDrawnPosition | null>,
  onFollowEnd: () => void,
) {
  const onEndRef = useRef(onFollowEnd);
  useEffect(() => {
    onEndRef.current = onFollowEnd;
  }, [onFollowEnd]);

  useEffect(() => {
    if (!map || !isLoaded || !followIcao24) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Zoom and pinch turn around the aircraft rather than the pointer.
    map.scrollZoom.enable({ around: "center" });
    map.touchZoomRotate.enable({ around: "center" });

    const onPan = (event: { originalEvent?: Event }) => {
      if (event.originalEvent) onEndRef.current();
    };
    for (const type of PAN_EVENTS) map.on(type, onPan);

    // Moving the camera stops MapLibre's gesture handlers, so while a finger
    // or the mouse is down the camera holds still; otherwise no drag could
    // ever start, and a pinch or a scroll would stutter.
    let pointerDown = false;
    const container = map.getCanvasContainer();
    const onDown = () => {
      pointerDown = true;
    };
    const onUp = () => {
      pointerDown = false;
    };
    container.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });

    let frame: number | null = null;
    let last: [number, number] | null = null;
    let entered = false;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const drawn = drawnRef.current;
      if (!drawn) return;
      // Let a card's own camera move, the way in, or a gesture finish first.
      if (pointerDown || map.isMoving()) return;

      if (!entered) {
        entered = true;
        const target = followZoom(map, drawn);
        const zoom = map.getZoom();
        if (zoom > target + 0.25 || zoom < Math.min(target, FOLLOW_MIN_ZOOM)) {
          map.easeTo({
            center: [drawn.lng, drawn.lat],
            zoom: target,
            duration: reduceMotion ? 0 : FOLLOW_ENTRY_MS,
            essential: false,
          });
          return;
        }
      }
      if (
        last &&
        Math.abs(last[0] - drawn.lng) < MOVE_EPSILON_DEG &&
        Math.abs(last[1] - drawn.lat) < MOVE_EPSILON_DEG
      ) {
        return;
      }
      last = [drawn.lng, drawn.lat];
      map.jumpTo({ center: centerForDrawn(map, drawn) });
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      for (const type of PAN_EVENTS) map.off(type, onPan);
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
    };
  }, [map, isLoaded, followIcao24, drawnRef]);
}

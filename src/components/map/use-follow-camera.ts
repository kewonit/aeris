"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  centerLngLatForScreenOffset,
  framingZoom,
  projectLngLatElevationPixelDelta,
} from "./camera-controller-utils";
import type { FpvDrawnPosition } from "./flight-layer-constants";

/** Following from further out than this first brings the aircraft closer. */
const FOLLOW_MIN_ZOOM = 7.5;
const FOLLOW_ENTRY_MS = 900;
/** Below this, a move is too small to be worth a camera update. */
const MOVE_EPSILON_DEG = 1e-7;
/**
 * After something else has moved the camera, the follow glides back onto
 * the aircraft over this long, closing most of the gap every GLIDE_TAU_MS.
 */
const GLIDE_MS = 700;
const GLIDE_TAU_MS = 120;

/** Gestures that take the camera back from the follow. */
const PAN_EVENTS = ["dragstart"] as const;

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
      const original = event.originalEvent;
      if (!original) return;
      // A pinch moves its midpoint too, which MapLibre reports as a drag;
      // only a one-finger drag pans away.
      if (
        typeof TouchEvent !== "undefined" &&
        original instanceof TouchEvent &&
        original.touches.length > 1
      ) {
        return;
      }
      onEndRef.current();
    };
    for (const type of PAN_EVENTS) map.on(type, onPan);

    // The arrow keys pan the map too; with Shift they turn and tilt it,
    // which the follow keeps.
    const onMoveStart = (event: { originalEvent?: Event }) => {
      const original = event.originalEvent;
      if (
        original instanceof KeyboardEvent &&
        original.key.startsWith("Arrow") &&
        !original.shiftKey
      ) {
        onEndRef.current();
      }
    };
    map.on("movestart", onMoveStart);

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
    // Set while something else holds the camera; the follow then glides
    // back from wherever that left it instead of jumping.
    let held = true;
    let glideStart = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(Math.max(now - lastTime, 0), 100);
      lastTime = now;
      const drawn = drawnRef.current;
      if (!drawn) return;
      // Let a card's own camera move, the way in, or a gesture finish first.
      if (pointerDown || map.isMoving()) {
        held = true;
        return;
      }

      if (!entered) {
        entered = true;
        const framing = framingZoom(map, drawn.lat, drawn.elevation);
        const zoom = map.getZoom();
        if (zoom > framing + 0.25 || zoom < Math.min(framing, FOLLOW_MIN_ZOOM)) {
          map.easeTo({
            center: [drawn.lng, drawn.lat],
            zoom: framing,
            duration: reduceMotion ? 0 : FOLLOW_ENTRY_MS,
            essential: false,
          });
          return;
        }
      }
      if (held) {
        held = false;
        glideStart = now;
        last = null;
      }

      const target = centerForDrawn(map, drawn);
      if (!reduceMotion && now - glideStart < GLIDE_MS) {
        const current = map.getCenter();
        const k = 1 - Math.exp(-dt / GLIDE_TAU_MS);
        const dLng = ((target[0] - current.lng + 540) % 360) - 180;
        map.jumpTo({
          center: [
            current.lng + dLng * k,
            current.lat + (target[1] - current.lat) * k,
          ],
        });
        return;
      }

      if (
        last &&
        Math.abs(last[0] - drawn.lng) < MOVE_EPSILON_DEG &&
        Math.abs(last[1] - drawn.lat) < MOVE_EPSILON_DEG
      ) {
        return;
      }
      last = [drawn.lng, drawn.lat];
      map.jumpTo({ center: target });
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      for (const type of PAN_EVENTS) map.off(type, onPan);
      map.off("movestart", onMoveStart);
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
    };
  }, [map, isLoaded, followIcao24, drawnRef]);
}

"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import { fpvFollowCamera, normalizeLng } from "./camera-controller-utils";
import type { FpvDrawnPosition } from "./flight-layer-constants";
import { createFollowPause, FOLLOW_RETURN_MS } from "./fpv-follow";
import { highlightAeroways } from "./fpv-scenery";
import { normalizeBearing } from "./flight-interpolation";

export const FPV_ENTER_DURATION_MS = 1_100;
/**
 * Close behind a landing aircraft the camera sits nearer the ground than
 * the map's usual zoom limit allows; clamped, it would fall behind. The
 * limit is raised for the session.
 */
const FPV_MAX_ZOOM = 18;
const FPV_SKY_RESTORE_MS = 600;
const EMPTY_PADDING = { top: 0, right: 0, bottom: 0, left: 0 } as const;
const FPV_DARK_SKY: maplibregl.SkySpecification = {
  "sky-color": "#080d16",
  "horizon-color": "#182431",
  "fog-color": "#101821",
  "sky-horizon-blend": 0.45,
  "fog-ground-blend": 0.18,
  "atmosphere-blend": 0.9,
};
const FPV_LIGHT_SKY: maplibregl.SkySpecification = {
  "sky-color": "#8eb9dc",
  "horizon-color": "#eef2f4",
  "fog-color": "#e8edef",
  "sky-horizon-blend": 0.45,
  "fog-ground-blend": 0.18,
  "atmosphere-blend": 0.9,
};
/** Map events that a drag, scroll or rotate by hand begins with. */
const INTERACTION_EVENTS = [
  "dragstart",
  "zoomstart",
  "rotatestart",
  "pitchstart",
  "move",
] as const;

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

function fpvSky(): maplibregl.SkySpecification {
  return isDarkTheme() ? FPV_DARK_SKY : FPV_LIGHT_SKY;
}

type CameraPose = {
  center: maplibregl.LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
  roll: number;
  elevation: number;
};

function currentPose(map: maplibregl.Map): CameraPose {
  return {
    center: map.getCenter(),
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    roll: map.getRoll(),
    elevation: map.getCenterElevation(),
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The camera part way from one pose to the follow pose. */
function blendCamera(
  from: CameraPose,
  to: maplibregl.CameraOptions,
  t: number,
): maplibregl.CameraOptions {
  const target = maplibregl.LngLat.convert(to.center!);
  const lng =
    from.center.lng +
    (((target.lng - from.center.lng + 540) % 360) - 180) * t;
  const bearingTurn = ((to.bearing! - from.bearing + 540) % 360) - 180;
  return {
    center: [
      normalizeLng(lng),
      from.center.lat + (target.lat - from.center.lat) * t,
    ],
    zoom: from.zoom + (to.zoom! - from.zoom) * t,
    pitch: from.pitch + (to.pitch! - from.pitch) * t,
    bearing: normalizeBearing(from.bearing + bearingTurn * t),
    roll: from.roll + ((to.roll ?? 0) - from.roll) * t,
    elevation: from.elevation + ((to.elevation ?? 0) - from.elevation) * t,
  };
}

/**
 * Flies the camera in behind the first person aircraft and keeps it there,
 * every frame, looking along its track with the aircraft in view.
 *
 * The camera follows the aircraft exactly where the flight layers draw it,
 * which glides smoothly between reports, so the aircraft never leaves the
 * frame. Entry waits for the first frame it is drawn, which also covers
 * deep links that open before the first poll.
 *
 * The map can still be dragged, zoomed and turned: following pauses while
 * it is, and eases back shortly after it stops.
 */
export function useFpvCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  fpvIcao24: string | null,
  drawnRef: MutableRefObject<FpvDrawnPosition | null>,
  isFpvActiveRef: MutableRefObject<boolean>,
) {
  // The sky to restore after FPV. It is captured once per FPV session, so
  // switching aircraft inside the restore delay keeps the original sky.
  const savedSkyRef = useRef<{
    sky: maplibregl.SkySpecification | undefined;
  } | null>(null);
  const skyRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!map || !isLoaded || !fpvIcao24) {
      isFpvActiveRef.current = false;
      return;
    }

    if (skyRestoreTimerRef.current) {
      clearTimeout(skyRestoreTimerRef.current);
      skyRestoreTimerRef.current = null;
    }
    savedSkyRef.current ??= { sky: map.getSky() };
    map.setSky(fpvSky());

    isFpvActiveRef.current = true;
    map.stop();
    const previousMaxZoom = map.getMaxZoom();
    map.setMaxZoom(Math.max(previousMaxZoom, FPV_MAX_ZOOM));

    let restoreAeroways = highlightAeroways(
      map,
      isDarkTheme() ? "dark" : "light",
    );
    // A style change replaces the sky and the runway paint.
    const onStyleLoad = () => {
      savedSkyRef.current = { sky: map.getSky() };
      map.setSky(fpvSky());
      restoreAeroways = highlightAeroways(
        map,
        isDarkTheme() ? "dark" : "light",
      );
    };
    map.on("style.load", onStyleLoad);

    // Only a move with a browser event behind it is the user's; the ones
    // this loop makes carry none.
    const pause = createFollowPause();
    const onInteraction = (event: { originalEvent?: Event }) => {
      if (event.originalEvent) pause.interact(performance.now());
    };
    for (const type of INTERACTION_EVENTS) map.on(type, onInteraction);

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frameId: number | null = null;
    let lastBearing = normalizeBearing(map.getBearing());
    // The way in, and the way back after the map was moved by hand.
    let transition: {
      from: CameraPose;
      startedAt: number;
      durationMs: number;
    } | null = null;
    let entered = reduceMotion;
    let wasPaused = false;

    const onFrame = (frameTime: number) => {
      frameId = requestAnimationFrame(onFrame);
      const drawn = drawnRef.current;
      if (!drawn) return;
      const target = fpvFollowCamera(map, drawn, lastBearing);
      if (!target) return;
      lastBearing = target.bearing ?? lastBearing;

      if (pause.paused(frameTime)) {
        wasPaused = true;
        transition = null;
        return;
      }
      if (wasPaused) {
        wasPaused = false;
        transition = {
          from: currentPose(map),
          startedAt: frameTime,
          durationMs: reduceMotion ? 0 : FOLLOW_RETURN_MS,
        };
      } else if (!entered) {
        entered = true;
        transition = {
          from: currentPose(map),
          startedAt: frameTime,
          durationMs: FPV_ENTER_DURATION_MS,
        };
      }

      if (transition) {
        const t =
          transition.durationMs > 0
            ? (frameTime - transition.startedAt) / transition.durationMs
            : 1;
        if (t < 1) {
          map.jumpTo({
            ...blendCamera(transition.from, target, easeInOut(Math.max(0, t))),
            padding: EMPTY_PADDING,
          });
          return;
        }
        transition = null;
      }
      map.jumpTo({ ...target, padding: EMPTY_PADDING });
    };
    frameId = requestAnimationFrame(onFrame);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      map.off("style.load", onStyleLoad);
      for (const type of INTERACTION_EVENTS) map.off(type, onInteraction);
      map.stop();
      restoreAeroways();
      map.setMaxZoom(previousMaxZoom);
      isFpvActiveRef.current = false;
      // Wait for the exit transition before putting the sky back, unless
      // another FPV session starts first and cancels this.
      skyRestoreTimerRef.current = setTimeout(() => {
        skyRestoreTimerRef.current = null;
        const saved = savedSkyRef.current;
        savedSkyRef.current = null;
        try {
          // Style.setSky accepts undefined to clear a sky the style never
          // had; the Map typing omits that case.
          map.setSky(saved?.sky as maplibregl.SkySpecification);
        } catch {
          // The map was removed during the delay.
        }
      }, FPV_SKY_RESTORE_MS);
    };
  }, [map, isLoaded, fpvIcao24, drawnRef, isFpvActiveRef]);
}

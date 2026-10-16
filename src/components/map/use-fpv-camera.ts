"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import {
  fpvCameraOptions,
  setMapInteractionsEnabled,
  type FpvCameraPosition,
} from "./camera-controller-utils";
import { normalizeBearing } from "./flight-interpolation";
import type { FlightState } from "@/lib/opensky";
import { ACTIVE_FRAME_INTERVAL_MS, isFrameDue } from "./frame-rate";

const FPV_ENTER_DURATION_MS = 1_100;
/** Time for the camera heading to cover about 63% of a turn. */
const FPV_BEARING_TIME_CONSTANT_MS = 170;
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

function fpvSky(): maplibregl.SkySpecification {
  return document.documentElement.classList.contains("dark")
    ? FPV_DARK_SKY
    : FPV_LIGHT_SKY;
}

/**
 * Flies the camera into the cockpit of the FPV aircraft and keeps it there.
 *
 * The effect is keyed on the aircraft id, not on its latest state, so a
 * poll that misses the aircraft holds the last camera instead of leaving
 * FPV. Entry waits for the first known position, which also covers deep
 * links that open before the first poll.
 */
export function useFpvCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  fpvIcao24: string | null,
  fpvFlightRef: MutableRefObject<FlightState | null>,
  fpvPosRef: MutableRefObject<
    MutableRefObject<FpvCameraPosition | null> | undefined
  >,
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
    // A style change replaces the sky, so save the new style's sky instead.
    const onStyleLoad = () => {
      savedSkyRef.current = { sky: map.getSky() };
      map.setSky(fpvSky());
    };
    map.on("style.load", onStyleLoad);

    isFpvActiveRef.current = true;
    map.stop();
    setMapInteractionsEnabled(map, false);

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frameId: number | null = null;
    let lastFrameAt = 0;
    let enteredUntil: number | null = null;
    let cameraBearing = normalizeBearing(map.getBearing());

    const currentPosition = (): FpvCameraPosition | null => {
      const interpolated = fpvPosRef.current?.current;
      if (interpolated) return interpolated;
      const live = fpvFlightRef.current;
      if (live?.longitude == null || live.latitude == null) return null;
      return {
        lng: live.longitude,
        lat: live.latitude,
        alt: live.baroAltitude,
        track: live.trueTrack,
      };
    };

    const enter = (position: FpvCameraPosition, now: number) => {
      if (position.track !== null) {
        cameraBearing = normalizeBearing(position.track);
      }
      const camera = fpvCameraOptions(map, position, cameraBearing);
      if (!camera) return;
      const duration = reduceMotion ? 0 : FPV_ENTER_DURATION_MS;
      if (duration === 0) {
        map.jumpTo({ ...camera, padding: EMPTY_PADDING });
      } else {
        map.flyTo({
          ...camera,
          padding: EMPTY_PADDING,
          duration,
          essential: false,
        });
      }
      enteredUntil = now + duration;
    };

    const follow = (position: FpvCameraPosition, elapsedMs: number) => {
      if (position.track !== null) {
        const delta = ((position.track - cameraBearing + 540) % 360) - 180;
        const weight = 1 - Math.exp(-elapsedMs / FPV_BEARING_TIME_CONSTANT_MS);
        cameraBearing = normalizeBearing(cameraBearing + delta * weight);
      }
      const camera = fpvCameraOptions(
        map,
        { ...position, track: cameraBearing },
        cameraBearing,
      );
      if (camera) map.jumpTo({ ...camera, padding: EMPTY_PADDING });
    };

    const onFrame = (now: number) => {
      frameId = requestAnimationFrame(onFrame);
      if (!isFrameDue(lastFrameAt, now, ACTIVE_FRAME_INTERVAL_MS)) return;
      const elapsedMs = lastFrameAt > 0 ? now - lastFrameAt : 0;
      lastFrameAt = now;

      const position = currentPosition();
      if (!position) return;
      if (enteredUntil === null) enter(position, now);
      else if (now >= enteredUntil) follow(position, elapsedMs);
    };
    frameId = requestAnimationFrame(onFrame);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      map.off("style.load", onStyleLoad);
      map.stop();
      setMapInteractionsEnabled(map, true);
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
  }, [map, isLoaded, fpvIcao24, fpvFlightRef, fpvPosRef, isFpvActiveRef]);
}

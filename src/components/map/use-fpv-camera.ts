"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import {
  fpvCameraOptions,
  normalizeLng,
  setMapInteractionsEnabled,
} from "./camera-controller-utils";
import { createFpvMotion, type FpvMotion } from "./fpv-motion";
import {
  normalizeBearing,
  noteReceipt,
  reportLeadMs,
  type ReceiptDelays,
} from "./flight-interpolation";
import type { FlightState } from "@/lib/opensky";

const FPV_ENTER_DURATION_MS = 1_100;
/**
 * Near the ground the cockpit camera sits closer to its centre than the
 * map's usual zoom limit allows; clamped, the camera would leave the
 * aircraft. The limit is raised for the session.
 */
const FPV_MAX_ZOOM = 20;
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

/** The motion of this aircraft, started afresh for each new aircraft. */
function motionFor(
  ref: MutableRefObject<{ icao24: string; motion: FpvMotion } | null>,
  icao24: string,
): FpvMotion {
  if (ref.current?.icao24 !== icao24) {
    ref.current = { icao24, motion: createFpvMotion() };
  }
  return ref.current.motion;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The camera part way from one pose to the cockpit's, for the way in. */
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
    center: [normalizeLng(lng), from.center.lat + (target.lat - from.center.lat) * t],
    zoom: from.zoom + (to.zoom! - from.zoom) * t,
    pitch: from.pitch + (to.pitch! - from.pitch) * t,
    bearing: normalizeBearing(from.bearing + bearingTurn * t),
    roll: from.roll + ((to.roll ?? 0) - from.roll) * t,
    elevation: from.elevation + ((to.elevation ?? 0) - from.elevation) * t,
  };
}

/**
 * Flies the camera into the cockpit of the first person aircraft and keeps
 * it there, every frame.
 *
 * The aircraft is reported every few seconds; between reports the camera
 * follows the aircraft's own smoothed motion (fpv-motion), so it moves
 * continuously, turns smoothly, and never jumps when a report arrives. A
 * poll that misses the aircraft keeps it flying on its last report. Entry
 * waits for the first report, which also covers deep links that open
 * before the first poll.
 */
export function useFpvCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  fpvIcao24: string | null,
  fpvFlight: FlightState | null,
  isFpvActiveRef: MutableRefObject<boolean>,
) {
  const motionRef = useRef<{ icao24: string; motion: FpvMotion } | null>(null);
  // How quickly answers reach us, so a cached report is timed correctly.
  const receiptDelaysRef = useRef<ReceiptDelays>(new Map());
  // The sky to restore after FPV. It is captured once per FPV session, so
  // switching aircraft inside the restore delay keeps the original sky.
  const savedSkyRef = useRef<{
    sky: maplibregl.SkySpecification | undefined;
  } | null>(null);
  const skyRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Each poll's report of the aircraft feeds its motion.
  useEffect(() => {
    if (!fpvIcao24 || fpvFlight?.icao24.toLowerCase() !== fpvIcao24) return;
    const receivedAt = Date.now();
    noteReceipt(receiptDelaysRef.current, [fpvFlight], receivedAt);
    motionFor(motionRef, fpvIcao24).observe(
      fpvFlight,
      receivedAt,
      reportLeadMs(fpvFlight, receivedAt, receiptDelaysRef.current),
    );
  }, [fpvIcao24, fpvFlight]);

  useEffect(() => {
    if (!map || !isLoaded || !fpvIcao24) {
      isFpvActiveRef.current = false;
      if (!fpvIcao24) motionRef.current = null;
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
    const previousMaxZoom = map.getMaxZoom();
    map.setMaxZoom(FPV_MAX_ZOOM);

    const motion = motionFor(motionRef, fpvIcao24);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frameId: number | null = null;
    let lastBearing = normalizeBearing(map.getBearing());
    // Set on the first frame with a known position; null once entered.
    let entry: { from: CameraPose; startedAt: number } | null = null;
    let entered = reduceMotion;

    const onFrame = (frameTime: number) => {
      frameId = requestAnimationFrame(onFrame);
      const state = motion.stateAt(Date.now());
      if (!state) return;
      const target = fpvCameraOptions(map, state, lastBearing);
      if (!target) return;
      lastBearing = target.bearing ?? lastBearing;

      if (!entered) {
        entry ??= { from: currentPose(map), startedAt: frameTime };
        const t = (frameTime - entry.startedAt) / FPV_ENTER_DURATION_MS;
        if (t < 1) {
          map.jumpTo({
            ...blendCamera(entry.from, target, easeInOut(Math.max(0, t))),
            padding: EMPTY_PADDING,
          });
          return;
        }
        entered = true;
        entry = null;
      }
      map.jumpTo({ ...target, padding: EMPTY_PADDING });
    };
    frameId = requestAnimationFrame(onFrame);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      map.off("style.load", onStyleLoad);
      map.stop();
      map.setMaxZoom(previousMaxZoom);
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
  }, [map, isLoaded, fpvIcao24, isFpvActiveRef]);
}

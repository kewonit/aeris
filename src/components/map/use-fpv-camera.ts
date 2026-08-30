"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import {
  FPV_DEFAULT_ALTITUDE_METERS,
  fpvCameraOptions,
  normalizeBearing,
  setMapInteractionsEnabled,
} from "./camera-controller-utils";
import type { FlightState } from "@/lib/opensky";
import { ACTIVE_FRAME_INTERVAL_MS, isFrameDue } from "./frame-rate";

const FPV_ENTER_DURATION_MS = 1_100;
const FPV_BEARING_ALPHA = 0.18;
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

type FpvPosition = { lng: number; lat: number; alt: number; track: number };

export function useFpvCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  fpvFlight: FlightState | null,
  fpvFlightRef: MutableRefObject<FlightState | null>,
  fpvPosRef: MutableRefObject<MutableRefObject<FpvPosition | null> | undefined>,
  isFpvActiveRef: MutableRefObject<boolean>,
) {
  const skyRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!map || !isLoaded) {
      isFpvActiveRef.current = false;
      return;
    }

    const fpv = fpvFlightRef.current;
    if (!fpv || fpv.longitude == null || fpv.latitude == null) {
      isFpvActiveRef.current = false;
      return;
    }

    const fallbackBearing = map.getBearing();
    const initialPosition = {
      lng: fpv.longitude,
      lat: fpv.latitude,
      alt: Number.isFinite(fpv.baroAltitude)
        ? fpv.baroAltitude!
        : FPV_DEFAULT_ALTITUDE_METERS,
      track: Number.isFinite(fpv.trueTrack) ? fpv.trueTrack! : null,
    };
    const initialCamera = fpvCameraOptions(
      map,
      initialPosition,
      fallbackBearing,
    );
    if (!initialCamera) {
      isFpvActiveRef.current = false;
      return;
    }

    if (skyRestoreTimerRef.current) {
      clearTimeout(skyRestoreTimerRef.current);
      skyRestoreTimerRef.current = null;
    }
    const previousSky = map.getSky() as
      | maplibregl.SkySpecification
      | undefined;
    map.setSky(
      document.documentElement.classList.contains("dark")
        ? FPV_DARK_SKY
        : FPV_LIGHT_SKY,
    );

    isFpvActiveRef.current = true;
    map.stop();
    setMapInteractionsEnabled(map, false);

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const enterDuration = reduceMotion ? 0 : FPV_ENTER_DURATION_MS;

    if (reduceMotion) {
      map.jumpTo({ ...initialCamera, padding: EMPTY_PADDING });
    } else {
      map.flyTo({
        ...initialCamera,
        padding: EMPTY_PADDING,
        duration: enterDuration,
        essential: false,
      });
    }

    let frameId: number | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRenderedAt = 0;
    let cameraBearing = normalizeBearing(
      initialPosition.track ?? fallbackBearing,
    );

    const isPageActive = () =>
      document.visibilityState === "visible" &&
      (typeof document.hasFocus !== "function" || document.hasFocus());

    function scheduleFrame() {
      if (
        frameId == null &&
        startupTimer == null &&
        isFpvActiveRef.current &&
        isPageActive()
      ) {
        frameId = requestAnimationFrame(updateCamera);
      }
    }

    function suspendFrames() {
      if (frameId != null) cancelAnimationFrame(frameId);
      frameId = null;
      lastRenderedAt = 0;
    }

    function syncPageActivity() {
      if (isPageActive()) {
        scheduleFrame();
      } else {
        suspendFrames();
      }
    }

    function updateCamera(now: number) {
      frameId = null;
      if (!isFpvActiveRef.current || !map) return;

      if (!isPageActive()) {
        lastRenderedAt = 0;
        return;
      }

      if (!isFrameDue(lastRenderedAt, now, ACTIVE_FRAME_INTERVAL_MS)) {
        scheduleFrame();
        return;
      }
      lastRenderedAt = now;

      const interpolated = fpvPosRef.current?.current ?? null;
      const live = fpvFlightRef.current;
      const lng = interpolated?.lng ?? live?.longitude ?? null;
      const lat = interpolated?.lat ?? live?.latitude ?? null;
      const altitude =
        interpolated?.alt ??
        live?.baroAltitude ??
        FPV_DEFAULT_ALTITUDE_METERS;
      const track = interpolated?.track ?? live?.trueTrack ?? null;

      if (lng !== null && lat !== null) {
        if (track !== null && Number.isFinite(track)) {
          const bearingDelta = ((track - cameraBearing + 540) % 360) - 180;
          cameraBearing = normalizeBearing(
            cameraBearing + bearingDelta * FPV_BEARING_ALPHA,
          );
        }

        const camera = fpvCameraOptions(
          map,
          { lng, lat, alt: altitude, track: cameraBearing },
          cameraBearing,
        );
        if (camera) {
          map.jumpTo({ ...camera, padding: EMPTY_PADDING });
        }
      }

      scheduleFrame();
    }

    document.addEventListener("visibilitychange", syncPageActivity);
    window.addEventListener("blur", syncPageActivity);
    window.addEventListener("focus", syncPageActivity);
    window.addEventListener("pagehide", suspendFrames);
    window.addEventListener("pageshow", syncPageActivity);
    document.addEventListener("freeze", suspendFrames);
    document.addEventListener("resume", syncPageActivity);

    startupTimer = setTimeout(() => {
      startupTimer = null;
      scheduleFrame();
    }, enterDuration);

    return () => {
      if (startupTimer) clearTimeout(startupTimer);
      suspendFrames();
      document.removeEventListener("visibilitychange", syncPageActivity);
      window.removeEventListener("blur", syncPageActivity);
      window.removeEventListener("focus", syncPageActivity);
      window.removeEventListener("pagehide", suspendFrames);
      window.removeEventListener("pageshow", syncPageActivity);
      document.removeEventListener("freeze", suspendFrames);
      document.removeEventListener("resume", syncPageActivity);
      map.stop();
      setMapInteractionsEnabled(map, true);
      isFpvActiveRef.current = false;
      skyRestoreTimerRef.current = setTimeout(() => {
        try {
          (
            map as unknown as {
              setSky: (sky?: maplibregl.SkySpecification) => unknown;
            }
          ).setSky(previousSky);
        } catch {
          // The map may have been disposed while the exit transition finished.
        } finally {
          skyRestoreTimerRef.current = null;
        }
      }, FPV_SKY_RESTORE_MS);
    };
  }, [
    map,
    isLoaded,
    fpvFlight?.icao24,
    fpvFlightRef,
    fpvPosRef,
    isFpvActiveRef,
  ]);
}

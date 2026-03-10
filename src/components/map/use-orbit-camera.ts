"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { smoothstep } from "./camera-controller-utils";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import type { Settings } from "@/hooks/use-settings";

const IDLE_TIMEOUT_MS = 5_000;
const ORBIT_EASE_IN_MS = 2000;

export function useOrbitCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  city: City,
  followFlight: FlightState | null | undefined,
  fpvFlight: FlightState | null | undefined,
  settings: Settings,
  isInteractingRef: MutableRefObject<boolean>,
  orbitFrameRef: MutableRefObject<number | null>,
  idleTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  // Store speed in a ref so tick() reads the latest value without effect re-runs
  const speedRef = useRef(0);
  useEffect(() => {
    speedRef.current =
      settings.orbitSpeed * (settings.orbitDirection === "clockwise" ? 1 : -1);
  }, [settings.orbitSpeed, settings.orbitDirection]);

  useEffect(() => {
    if (
      !map ||
      !isLoaded ||
      !city ||
      !settings.autoOrbit ||
      followFlight ||
      fpvFlight
    ) {
      if (orbitFrameRef.current) cancelAnimationFrame(orbitFrameRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (prefersReducedMotion) return;

    function startOrbit() {
      if (!map || isInteractingRef.current) return;

      const resumeStart = performance.now();

      function tick() {
        if (!map || isInteractingRef.current) return;
        const resumeElapsed = performance.now() - resumeStart;
        const t = Math.min(resumeElapsed / ORBIT_EASE_IN_MS, 1);
        const easeFactor = smoothstep(t);
        const bearing = map.getBearing() + speedRef.current * easeFactor;
        map.setBearing(bearing % 360);
        orbitFrameRef.current = requestAnimationFrame(tick);
      }

      orbitFrameRef.current = requestAnimationFrame(tick);
    }

    function stopOrbit() {
      if (orbitFrameRef.current) {
        cancelAnimationFrame(orbitFrameRef.current);
        orbitFrameRef.current = null;
      }
    }

    function resetIdleTimer() {
      isInteractingRef.current = true;
      stopOrbit();

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        isInteractingRef.current = false;
        startOrbit();
      }, IDLE_TIMEOUT_MS);
    }

    const events = ["mousedown", "wheel", "touchstart"] as const;
    const container = map.getContainer();
    events.forEach((e) =>
      container.addEventListener(e, resetIdleTimer, { passive: true }),
    );

    const onMoveStart = () => {
      if (isInteractingRef.current) stopOrbit();
    };
    map.on("movestart", onMoveStart);

    const onCameraStop = (e: Event) => {
      const { type } = (e as CustomEvent).detail ?? {};
      if (type === "bearing") {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
          isInteractingRef.current = false;
          startOrbit();
        }, IDLE_TIMEOUT_MS);
      }
    };
    window.addEventListener("aeris:camera-stop", onCameraStop);

    idleTimerRef.current = setTimeout(() => {
      isInteractingRef.current = false;
      startOrbit();
    }, IDLE_TIMEOUT_MS);

    return () => {
      stopOrbit();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((e) => container.removeEventListener(e, resetIdleTimer));
      map.off("movestart", onMoveStart);
      window.removeEventListener("aeris:camera-stop", onCameraStop);
    };
  }, [map, isLoaded, city, followFlight, fpvFlight, settings.autoOrbit]);
}

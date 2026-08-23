"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { smoothstep } from "./camera-controller-utils";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import type { Settings } from "@/hooks/use-settings";
import { ACTIVE_FRAME_INTERVAL_MS, isFrameDue } from "./frame-rate";

const IDLE_TIMEOUT_MS = 5_000;
const ORBIT_EASE_IN_MS = 2000;

export function useOrbitCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  city: City,
  followFlight: FlightState | null | undefined,
  fpvFlight: FlightState | null | undefined,
  settings: Settings,
  suspended: boolean,
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
      suspended ||
      followFlight ||
      fpvFlight
    ) {
      if (orbitFrameRef.current != null) {
        cancelAnimationFrame(orbitFrameRef.current);
        orbitFrameRef.current = null;
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    const reducedMotionQuery = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    const isPageActive = () =>
      document.visibilityState === "visible" &&
      (typeof document.hasFocus !== "function" || document.hasFocus());

    function startOrbit() {
      if (
        !map ||
        isInteractingRef.current ||
        reducedMotionQuery?.matches ||
        !isPageActive() ||
        orbitFrameRef.current != null
      ) {
        return;
      }

      const resumeStart = performance.now();
      let lastTime = 0;
      let lastRenderedAt = 0;

      function tick(now: number) {
        orbitFrameRef.current = null;
        if (
          !map ||
          isInteractingRef.current ||
          reducedMotionQuery?.matches ||
          !isPageActive()
        ) {
          return;
        }

        if (!isFrameDue(lastRenderedAt, now, ACTIVE_FRAME_INTERVAL_MS)) {
          orbitFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60;
        lastTime = now;
        lastRenderedAt = now;

        const resumeElapsed = now - resumeStart;
        const t = Math.min(resumeElapsed / ORBIT_EASE_IN_MS, 1);
        const easeFactor = smoothstep(t);
        const bearing =
          map.getBearing() + speedRef.current * easeFactor * dt * 60;
        map.setBearing(bearing % 360);
        orbitFrameRef.current = requestAnimationFrame(tick);
      }

      orbitFrameRef.current = requestAnimationFrame(tick);
    }

    function stopOrbit() {
      if (orbitFrameRef.current != null) {
        cancelAnimationFrame(orbitFrameRef.current);
        orbitFrameRef.current = null;
      }
    }

    function scheduleOrbitAfterIdle() {
      stopOrbit();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        if (!isPageActive() || reducedMotionQuery?.matches) return;
        isInteractingRef.current = false;
        startOrbit();
      }, IDLE_TIMEOUT_MS);
    }

    function resetIdleTimer() {
      isInteractingRef.current = true;
      scheduleOrbitAfterIdle();
    }

    function suspendOrbit() {
      stopOrbit();
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }

    function resumeOrbit() {
      if (!isPageActive() || reducedMotionQuery?.matches) return;
      scheduleOrbitAfterIdle();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") resumeOrbit();
      else suspendOrbit();
    }

    function handleReducedMotionChange() {
      if (reducedMotionQuery?.matches) suspendOrbit();
      else resumeOrbit();
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
        scheduleOrbitAfterIdle();
      }
    };
    window.addEventListener("aeris:camera-stop", onCameraStop);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", suspendOrbit);
    window.addEventListener("focus", resumeOrbit);
    window.addEventListener("pagehide", suspendOrbit);
    window.addEventListener("pageshow", resumeOrbit);
    document.addEventListener("freeze", suspendOrbit);
    document.addEventListener("resume", resumeOrbit);
    reducedMotionQuery?.addEventListener("change", handleReducedMotionChange);

    resumeOrbit();

    return () => {
      suspendOrbit();
      events.forEach((e) => container.removeEventListener(e, resetIdleTimer));
      map.off("movestart", onMoveStart);
      window.removeEventListener("aeris:camera-stop", onCameraStop);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", suspendOrbit);
      window.removeEventListener("focus", resumeOrbit);
      window.removeEventListener("pagehide", suspendOrbit);
      window.removeEventListener("pageshow", resumeOrbit);
      document.removeEventListener("freeze", suspendOrbit);
      document.removeEventListener("resume", resumeOrbit);
      reducedMotionQuery?.removeEventListener(
        "change",
        handleReducedMotionChange,
      );
    };
  }, [
    map,
    isLoaded,
    city,
    followFlight,
    fpvFlight,
    settings.autoOrbit,
    suspended,
    isInteractingRef,
    orbitFrameRef,
    idleTimerRef,
  ]);
}

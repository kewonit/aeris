"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./map";
import { useSettings } from "@/hooks/use-settings";
import type { City } from "@/lib/cities";

const IDLE_TIMEOUT_MS = 5_000;
const ORBIT_EASE_IN_MS = 2000;
const DEFAULT_ZOOM = 9.2;
const DEFAULT_PITCH = 49;
const DEFAULT_BEARING = 27.4;

export function CameraController({ city }: { city: City }) {
  const { map, isLoaded } = useMap();
  const { settings } = useSettings();
  const prevCityRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbitFrameRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);

  useEffect(() => {
    if (!map || !isLoaded || !city) return;
    if (city.id === prevCityRef.current) return;

    prevCityRef.current = city.id;
    map.flyTo({
      center: city.coordinates,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      duration: 2800,
      essential: true,
    });
  }, [map, isLoaded, city]);

  useEffect(() => {
    if (!map || !isLoaded || !city) return;

    const onNorthUp = () => {
      map.easeTo({
        bearing: 0,
        duration: 650,
        essential: true,
      });
    };

    const onResetView = (event: Event) => {
      const customEvent = event as CustomEvent<{ center?: [number, number] }>;
      const center = customEvent.detail?.center ?? city.coordinates;
      map.flyTo({
        center,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: 1200,
        essential: true,
      });
    };

    window.addEventListener("aeris:north-up", onNorthUp);
    window.addEventListener("aeris:reset-view", onResetView);

    return () => {
      window.removeEventListener("aeris:north-up", onNorthUp);
      window.removeEventListener("aeris:reset-view", onResetView);
    };
  }, [map, isLoaded, city]);

  useEffect(() => {
    if (!map || !isLoaded || !city || !settings.autoOrbit) {
      if (orbitFrameRef.current) cancelAnimationFrame(orbitFrameRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (prefersReducedMotion) return;

    const directionMultiplier =
      settings.orbitDirection === "clockwise" ? 1 : -1;
    const speed = settings.orbitSpeed * directionMultiplier;

    function startOrbit() {
      if (!map || isInteractingRef.current) return;

      const resumeStart = performance.now();

      function tick() {
        if (!map || isInteractingRef.current) return;
        const resumeElapsed = performance.now() - resumeStart;
        const t = Math.min(resumeElapsed / ORBIT_EASE_IN_MS, 1);
        const easeFactor = t * t * (3 - 2 * t);
        const bearing = map.getBearing() + speed * easeFactor;
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

    idleTimerRef.current = setTimeout(() => {
      isInteractingRef.current = false;
      startOrbit();
    }, IDLE_TIMEOUT_MS);

    return () => {
      stopOrbit();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((e) => container.removeEventListener(e, resetIdleTimer));
      map.off("movestart", onMoveStart);
    };
  }, [
    map,
    isLoaded,
    city,
    settings.autoOrbit,
    settings.orbitSpeed,
    settings.orbitDirection,
  ]);

  return null;
}

"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useMap } from "./map";
import { smoothstep } from "./camera-controller-utils";
import { useSettings } from "@/hooks/use-settings";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import { useFpvCamera } from "./use-fpv-camera";
import { useKeyboardCamera } from "./use-keyboard-camera";
import { useOrbitCamera } from "./use-orbit-camera";

const DEFAULT_ZOOM = 9.2;
const DEFAULT_PITCH = 49;
const DEFAULT_BEARING = 27.4;
const FOLLOW_ZOOM = 10.5;
const FOLLOW_PITCH = 55;
const FOLLOW_EASE_MS = 1200;

type FpvPosition = { lng: number; lat: number; alt: number; track: number };

export function CameraController({
  city,
  followFlight = null,
  fpvFlight = null,
  fpvPositionRef,
}: {
  city: City;
  followFlight?: FlightState | null;
  fpvFlight?: FlightState | null;
  fpvPositionRef?: MutableRefObject<FpvPosition | null>;
}) {
  const { map, isLoaded } = useMap();
  const { settings } = useSettings();
  const prevCityRef = useRef<string | null>(null);
  const prevFollowRef = useRef<string | null>(null);
  const prevFpvRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbitFrameRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const isFollowingRef = useRef(false);
  const isFpvActiveRef = useRef(false);
  const fpvFlightRef = useRef<FlightState | null>(fpvFlight);
  const fpvPosRef = useRef(fpvPositionRef);

  useEffect(() => {
    fpvPosRef.current = fpvPositionRef;
  }, [fpvPositionRef]);

  useEffect(() => {
    fpvFlightRef.current = fpvFlight;
  }, [fpvFlight]);

  // City flyTo
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

  // Follow flight init
  useEffect(() => {
    if (!map || !isLoaded) return;

    const followKey = followFlight?.icao24 ?? null;
    if (followKey === prevFollowRef.current) return;
    prevFollowRef.current = followKey;

    if (
      !followFlight ||
      followFlight.longitude == null ||
      followFlight.latitude == null
    ) {
      isFollowingRef.current = false;
      return;
    }

    isFollowingRef.current = true;
    const bearing = Number.isFinite(followFlight.trueTrack)
      ? followFlight.trueTrack!
      : map.getBearing();

    map.flyTo({
      center: [followFlight.longitude, followFlight.latitude],
      zoom: FOLLOW_ZOOM,
      pitch: FOLLOW_PITCH,
      bearing,
      duration: 2200,
      essential: true,
    });
  }, [map, isLoaded, followFlight]);

  // Follow flight continuous update
  useEffect(() => {
    if (!map || !isLoaded || !followFlight) return;
    if (followFlight.longitude == null || followFlight.latitude == null) return;

    if (!isFollowingRef.current) return;

    map.easeTo({
      center: [followFlight.longitude, followFlight.latitude],
      bearing: Number.isFinite(followFlight.trueTrack)
        ? followFlight.trueTrack!
        : map.getBearing(),
      duration: FOLLOW_EASE_MS,
      essential: true,
    });
  }, [
    map,
    isLoaded,
    followFlight,
    followFlight?.longitude,
    followFlight?.latitude,
    followFlight?.trueTrack,
  ]);

  // FPV camera hook
  useFpvCamera(
    map,
    isLoaded,
    fpvFlight,
    city,
    fpvFlightRef,
    fpvPosRef,
    isFpvActiveRef,
    prevFpvRef,
  );

  // North-up & reset-view
  useEffect(() => {
    if (!map || !isLoaded || !city) return;

    let northUpRafId: number | undefined;

    const onNorthUp = () => {
      if (isFpvActiveRef.current) return;
      if (northUpRafId != null) cancelAnimationFrame(northUpRafId);
      const startBearing = map.getBearing();
      const delta = ((0 - startBearing + 540) % 360) - 180;
      if (Math.abs(delta) < 0.5) {
        map.setBearing(0);
        return;
      }
      const duration = 650;
      const start = performance.now();
      function animateBearing() {
        const t = Math.min((performance.now() - start) / duration, 1);
        const eased = smoothstep(t);
        map!.setBearing(startBearing + delta * eased);
        if (t < 1) {
          northUpRafId = requestAnimationFrame(animateBearing);
        } else {
          northUpRafId = undefined;
        }
      }
      northUpRafId = requestAnimationFrame(animateBearing);
    };

    const onResetView = (event: Event) => {
      if (isFpvActiveRef.current) return;
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
      if (northUpRafId != null) cancelAnimationFrame(northUpRafId);
      window.removeEventListener("aeris:north-up", onNorthUp);
      window.removeEventListener("aeris:reset-view", onResetView);
    };
  }, [map, isLoaded, city]);

  // Keyboard camera hook
  useKeyboardCamera(
    map,
    isLoaded,
    isFpvActiveRef,
    isInteractingRef,
    idleTimerRef,
  );

  // Auto-orbit hook
  useOrbitCamera(
    map,
    isLoaded,
    city,
    followFlight,
    fpvFlight,
    settings,
    isInteractingRef,
    orbitFrameRef,
    idleTimerRef,
  );

  return null;
}

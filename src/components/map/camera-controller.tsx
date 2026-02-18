"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useMap } from "./map";
import { useSettings } from "@/hooks/use-settings";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";

const IDLE_TIMEOUT_MS = 5_000;
const ORBIT_EASE_IN_MS = 2000;
const DEFAULT_ZOOM = 9.2;
const DEFAULT_PITCH = 49;
const DEFAULT_BEARING = 27.4;
const FOLLOW_ZOOM = 10.5;
const FOLLOW_PITCH = 55;
const FOLLOW_EASE_MS = 1200;

const FPV_FLY_DURATION = 2500;

const CAMERA_ACCEL = 2.5;
const CAMERA_DECEL = 4.0;
const ZOOM_SPEED = 1.2;
const PITCH_SPEED = 28;
const BEARING_SPEED = 55;
const MINIMUM_IMPULSE_DURATION_MS = 180;

type CameraActionType = "zoom" | "pitch" | "bearing";
type ActionState = {
  direction: number;
  velocity: number;
  held: boolean;
  impulseEnd: number;
};

export function CameraController({
  city,
  followFlight = null,
  fpvFlight = null,
  fpvPositionRef,
}: {
  city: City;
  followFlight?: FlightState | null;
  fpvFlight?: FlightState | null;
  fpvPositionRef?: MutableRefObject<{
    lng: number;
    lat: number;
    alt: number;
    track: number;
  } | null>;
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
  const fpvSettingsRef = useRef({
    pitch: settings.fpvPitch,
    freeCamera: settings.fpvFreeCamera,
  });

  useEffect(() => {
    fpvFlightRef.current = fpvFlight;
  }, [fpvFlight]);

  useEffect(() => {
    fpvSettingsRef.current = {
      pitch: settings.fpvPitch,
      freeCamera: settings.fpvFreeCamera,
    };
  }, [settings.fpvPitch, settings.fpvFreeCamera]);

  useEffect(() => {
    if (!map || !isFpvActiveRef.current) return;
    if (settings.fpvFreeCamera) {
      map.dragPan.enable();
      map.dragRotate.enable();
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
      map.doubleClickZoom.disable();
      map.keyboard.enable();
    } else {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.touchZoomRotate.disable();
      map.doubleClickZoom.disable();
      map.keyboard.disable();
    }
  }, [map, settings.fpvFreeCamera]);

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
    const bearing = followFlight.trueTrack ?? map.getBearing();

    map.flyTo({
      center: [followFlight.longitude, followFlight.latitude],
      zoom: FOLLOW_ZOOM,
      pitch: FOLLOW_PITCH,
      bearing,
      duration: 2200,
      essential: true,
    });
  }, [map, isLoaded, followFlight]);

  useEffect(() => {
    if (!map || !isLoaded || !followFlight) return;
    if (followFlight.longitude == null || followFlight.latitude == null) return;

    if (!isFollowingRef.current) return;

    map.easeTo({
      center: [followFlight.longitude, followFlight.latitude],
      bearing: followFlight.trueTrack ?? map.getBearing(),
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

  const FPV_DISTANCE_ZOOM_OFFSET = 1.1;

  function fpvZoomForAltitude(altMeters: number): number {
    const alt = Math.max(altMeters, 0);
    if (alt < 50) return 16.2;
    const z = 18.1 - 2.0 * Math.log10(Math.max(alt, 50));
    return Math.max(10.1, Math.min(16.2, z));
  }

  const fpvFrameRef = useRef<number | null>(null);
  useEffect(() => {
    if (!map || !isLoaded) {
      if (isFpvActiveRef.current) {
        isFpvActiveRef.current = false;
        if (fpvFrameRef.current) {
          cancelAnimationFrame(fpvFrameRef.current);
          fpvFrameRef.current = null;
        }
      }
      return;
    }

    const fpv = fpvFlightRef.current;
    const fpvKey = fpv?.icao24 ?? null;
    if (fpvKey === prevFpvRef.current) return;

    const wasFpv = prevFpvRef.current !== null;
    prevFpvRef.current = fpvKey;

    if (fpvFrameRef.current) {
      cancelAnimationFrame(fpvFrameRef.current);
      fpvFrameRef.current = null;
    }

    if (!fpv || fpv.longitude == null || fpv.latitude == null) {
      isFpvActiveRef.current = false;
      if (wasFpv) {
        map.dragPan.enable();
        map.scrollZoom.enable();
        map.touchZoomRotate.enable();
        map.doubleClickZoom.enable();
        map.keyboard.enable();
      }
      if (wasFpv) {
        map.flyTo({
          center: city.coordinates,
          zoom: DEFAULT_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: 1800,
          essential: true,
        });
      }
      return;
    }

    isFpvActiveRef.current = true;
    const initialSettings = fpvSettingsRef.current;

    if (initialSettings.freeCamera) {
      map.dragPan.enable();
      map.dragRotate.enable();
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
      map.doubleClickZoom.disable();
      map.keyboard.enable();
    } else {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.touchZoomRotate.disable();
      map.doubleClickZoom.disable();
      map.keyboard.disable();
    }

    const bearing = fpv.trueTrack ?? map.getBearing();
    const zoom =
      fpvZoomForAltitude(fpv.baroAltitude ?? 5000) - FPV_DISTANCE_ZOOM_OFFSET;
    const fpvPitch = initialSettings.pitch;

    const centerLng = ((fpv.longitude + 540) % 360) - 180;

    map.flyTo({
      center: [centerLng, fpv.latitude],
      zoom,
      pitch: fpvPitch,
      bearing,
      duration: FPV_FLY_DURATION,
      essential: true,
    });

    let currentBearing = bearing;
    let currentZoom = zoom;

    let lastPos = {
      lng: fpv.longitude,
      lat: fpv.latitude,
      alt: fpv.baroAltitude ?? 5000,
      track: bearing,
    };

    function lerpAngleDeg(from: number, to: number, t: number): number {
      const diff = ((to - from + 540) % 360) - 180;
      return from + diff * t;
    }

    function tick() {
      if (!isFpvActiveRef.current || !map) {
        fpvFrameRef.current = null;
        return;
      }

      const pos = fpvPositionRef?.current;
      const fallback = fpvFlightRef.current;
      const sourceLng = pos?.lng ?? fallback?.longitude ?? lastPos.lng;
      const sourceLat = pos?.lat ?? fallback?.latitude ?? lastPos.lat;
      const sourceAlt = pos?.alt ?? fallback?.baroAltitude ?? lastPos.alt;
      const sourceTrack = pos?.track ?? fallback?.trueTrack ?? lastPos.track;

      lastPos = {
        lng: sourceLng,
        lat: sourceLat,
        alt: sourceAlt,
        track: sourceTrack,
      };

      const currentSettings = fpvSettingsRef.current;

      if (currentSettings.freeCamera) {
        const camLng = ((sourceLng + 540) % 360) - 180;
        map.jumpTo({ center: [camLng, sourceLat] });
      } else {
        currentBearing = lerpAngleDeg(currentBearing, sourceTrack, 0.15);
        const zoomTarget =
          fpvZoomForAltitude(sourceAlt) - FPV_DISTANCE_ZOOM_OFFSET;
        currentZoom += (zoomTarget - currentZoom) * 0.1;

        const camLng = ((sourceLng + 540) % 360) - 180;

        const DEG_PER_PX_AT_Z0 = 360 / 512;
        const degPerPx = DEG_PER_PX_AT_Z0 / Math.pow(2, currentZoom);
        const forwardPx = 120;
        const forwardDeg = forwardPx * degPerPx;
        const headingRad = (currentBearing * Math.PI) / 180;
        const offsetLng = camLng + Math.sin(headingRad) * forwardDeg;
        const offsetLat = sourceLat + Math.cos(headingRad) * forwardDeg;

        map.jumpTo({
          center: [offsetLng, offsetLat],
          bearing: currentBearing,
          zoom: currentZoom,
          pitch: currentSettings.pitch,
        });
      }

      fpvFrameRef.current = requestAnimationFrame(tick);
    }

    fpvFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (fpvFrameRef.current) {
        cancelAnimationFrame(fpvFrameRef.current);
        fpvFrameRef.current = null;
      }
      if (map && isFpvActiveRef.current) {
        map.dragPan.enable();
        map.scrollZoom.enable();
        map.touchZoomRotate.enable();
        map.doubleClickZoom.enable();
        map.keyboard.enable();
        isFpvActiveRef.current = false;
      }
    };
  }, [map, isLoaded, fpvFlight?.icao24, city, fpvPositionRef]);

  useEffect(() => {
    if (!map || !isLoaded || !city) return;

    const onNorthUp = () => {
      if (isFpvActiveRef.current) return;
      map.easeTo({
        bearing: 0,
        duration: 650,
        essential: true,
      });
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
      window.removeEventListener("aeris:north-up", onNorthUp);
      window.removeEventListener("aeris:reset-view", onResetView);
    };
  }, [map, isLoaded, city]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const actions = new Map<CameraActionType, ActionState>();
    let frameId: number | null = null;
    let lastTime = 0;

    function getOrCreate(
      type: CameraActionType,
      direction: number,
    ): ActionState {
      let s = actions.get(type);
      if (!s) {
        s = { direction, velocity: 0, held: false, impulseEnd: 0 };
        actions.set(type, s);
      }
      return s;
    }

    function maxSpeed(type: CameraActionType): number {
      if (type === "zoom") return ZOOM_SPEED;
      if (type === "pitch") return PITCH_SPEED;
      return BEARING_SPEED;
    }

    function applyDelta(type: CameraActionType, delta: number) {
      if (type === "zoom") {
        const z = map!.getZoom() + delta;
        map!.setZoom(
          Math.min(Math.max(z, map!.getMinZoom()), map!.getMaxZoom()),
        );
      } else if (type === "pitch") {
        const p = map!.getPitch() + delta;
        map!.setPitch(Math.min(Math.max(p, 0), map!.getMaxPitch()));
      } else {
        map!.setBearing(map!.getBearing() + delta);
      }
    }

    function tick(now: number) {
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0.016;
      lastTime = now;

      let anyActive = false;

      for (const [type, state] of actions) {
        const wantSpeed = state.held || now < state.impulseEnd;

        if (wantSpeed) {
          state.velocity = Math.min(
            state.velocity + CAMERA_ACCEL * dt * maxSpeed(type),
            maxSpeed(type),
          );
        } else {
          state.velocity = Math.max(
            state.velocity - CAMERA_DECEL * dt * maxSpeed(type),
            0,
          );
        }

        if (state.velocity > 0.001) {
          applyDelta(type, state.direction * state.velocity * dt);
          anyActive = true;
        } else {
          state.velocity = 0;
          if (!state.held) {
            actions.delete(type);
            if (type === "bearing") {
              isInteractingRef.current = false;
            }
          }
        }
      }

      frameId = anyActive ? requestAnimationFrame(tick) : null;
    }

    function ensureLoop() {
      if (frameId == null) {
        lastTime = 0;
        frameId = requestAnimationFrame(tick);
      }
    }

    const onStart = (e: Event) => {
      if (isFpvActiveRef.current) return;
      const { type, direction } = (e as CustomEvent).detail as {
        type: CameraActionType;
        direction: number;
      };
      const state = getOrCreate(type, direction);
      state.direction = direction;
      state.held = true;
      state.impulseEnd = performance.now() + MINIMUM_IMPULSE_DURATION_MS;

      if (type === "bearing") {
        isInteractingRef.current = true;
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      }

      ensureLoop();
    };

    const onStop = (e: Event) => {
      const { type } = (e as CustomEvent).detail as { type: CameraActionType };
      const state = actions.get(type);
      if (state) state.held = false;
    };

    window.addEventListener("aeris:camera-start", onStart);
    window.addEventListener("aeris:camera-stop", onStop);

    return () => {
      window.removeEventListener("aeris:camera-start", onStart);
      window.removeEventListener("aeris:camera-stop", onStop);
      if (frameId != null) cancelAnimationFrame(frameId);
    };
  }, [map, isLoaded]);

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
  }, [
    map,
    isLoaded,
    city,
    followFlight,
    fpvFlight,
    settings.autoOrbit,
    settings.orbitSpeed,
    settings.orbitDirection,
  ]);

  return null;
}

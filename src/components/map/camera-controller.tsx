"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useMap } from "./map";
import {
  FPV_DISTANCE_ZOOM_OFFSET,
  fpvZoomForAltitude,
  lerp,
  lerpLng,
  normalizeLng,
  projectLngLatElevationPixelDelta,
  setMapInteractionsEnabled,
  smoothstep,
} from "./camera-controller-utils";
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

const FPV_FLY_DURATION = 1600;
const FPV_PITCH = 65;
const FPV_CENTER_ALPHA = 0.16;
const FPV_BEARING_ALPHA = 0.1;
const FPV_ZOOM_ALPHA = 0.06;
const FPV_IDLE_RECENTER_MS = 1200;
const FPV_EASE_IN_MS = 600;

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

  useEffect(() => {
    if (!map || !isLoaded) {
      if (isFpvActiveRef.current) {
        isFpvActiveRef.current = false;
      }
      return;
    }

    const fpv = fpvFlightRef.current;
    const fpvKey = fpv?.icao24 ?? null;
    if (fpvKey === prevFpvRef.current) return;

    const wasFpv = prevFpvRef.current !== null;
    prevFpvRef.current = fpvKey;

    if (!fpv || fpv.longitude == null || fpv.latitude == null) {
      isFpvActiveRef.current = false;
      if (wasFpv) {
        setMapInteractionsEnabled(map, true);
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
    setMapInteractionsEnabled(map, true);

    const bearing = Number.isFinite(fpv.trueTrack)
      ? fpv.trueTrack!
      : map.getBearing();
    const safeAltitude = Number.isFinite(fpv.baroAltitude)
      ? fpv.baroAltitude!
      : 5000;
    const zoom = fpvZoomForAltitude(safeAltitude) - FPV_DISTANCE_ZOOM_OFFSET;

    let fpvOffsetX = 0;
    let fpvOffsetY = 0;

    map.flyTo({
      center: [normalizeLng(fpv.longitude), fpv.latitude],
      zoom,
      pitch: FPV_PITCH,
      bearing,
      duration: FPV_FLY_DURATION,
      essential: true,
    });

    let frameId: number | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let prevBearing = bearing;

    let lastInteractionTime = 0; // 0 = no interaction yet → track immediately
    let recenterStartTime = 0;
    let programmaticMove = false;

    function onUserInteraction() {
      if (programmaticMove) return;
      lastInteractionTime = performance.now();
      recenterStartTime = 0;
    }

    const onMapInteraction = (e: unknown) => {
      if (programmaticMove) return;
      const evt = e as { originalEvent?: Event };
      if (!evt?.originalEvent) return;
      onUserInteraction();
    };

    const interactionEventTypes = [
      "movestart",
      "move",
      "zoomstart",
      "zoom",
      "rotatestart",
      "rotate",
      "pitchstart",
      "pitch",
    ] as const;

    for (const t of interactionEventTypes) {
      map.on(t, onMapInteraction);
    }

    function keepInFrame() {
      if (!isFpvActiveRef.current || !map) {
        frameId = null;
        return;
      }

      const interpPos = fpvPosRef.current?.current ?? null;
      const live = fpvFlightRef.current;

      const posLng = interpPos?.lng ?? live?.longitude ?? null;
      const posLat = interpPos?.lat ?? live?.latitude ?? null;
      const posAlt = interpPos?.alt ?? live?.baroAltitude ?? 5000;
      const posTrack = interpPos?.track ?? live?.trueTrack ?? null;

      if (posLng == null || posLat == null) {
        frameId = requestAnimationFrame(keepInFrame);
        return;
      }

      if (
        !Number.isFinite(posLng) ||
        !Number.isFinite(posLat) ||
        Math.abs(posLat) > 90
      ) {
        frameId = requestAnimationFrame(keepInFrame);
        return;
      }

      const now = performance.now();
      const idleMs =
        lastInteractionTime === 0
          ? FPV_IDLE_RECENTER_MS + 1
          : now - lastInteractionTime;
      const isIdle = idleMs > FPV_IDLE_RECENTER_MS;

      let trackingStrength = 0;
      if (isIdle) {
        if (recenterStartTime === 0) {
          recenterStartTime = now;
        }
        const easeElapsed = now - recenterStartTime;
        const t = Math.min(easeElapsed / FPV_EASE_IN_MS, 1);
        trackingStrength = smoothstep(t);
      }

      const liveBearing =
        posTrack !== null && Number.isFinite(posTrack) ? posTrack : prevBearing;
      const bearingDelta = ((liveBearing - prevBearing + 540) % 360) - 180;
      prevBearing = prevBearing + bearingDelta * FPV_BEARING_ALPHA;

      if (trackingStrength > 0.001) {
        const safeAlt = Number.isFinite(posAlt) ? posAlt : 5000;
        const targetZoom =
          fpvZoomForAltitude(safeAlt) - FPV_DISTANCE_ZOOM_OFFSET;
        const currentZoom = map.getZoom();
        const zoomAlpha = FPV_ZOOM_ALPHA * trackingStrength;
        const smoothZoom = lerp(currentZoom, targetZoom, zoomAlpha);

        const currentPitch = map.getPitch();
        const targetLng = normalizeLng(posLng);
        const targetLat = posLat;
        const center = map.getCenter();
        const centerAlpha = FPV_CENTER_ALPHA * trackingStrength;

        const canvas = map.getCanvas();
        const canvasW = Math.max(1, canvas.clientWidth);
        const canvasH = Math.max(1, canvas.clientHeight);

        const elevationMeters = Math.max(safeAlt * 5, 200);
        const deltaPx = projectLngLatElevationPixelDelta(
          map,
          targetLng,
          targetLat,
          elevationMeters,
        );
        if (deltaPx) {
          const desiredX = fpvOffsetX - deltaPx.dx;
          const desiredY = fpvOffsetY - deltaPx.dy;
          const offsetAlpha = 0.08 * trackingStrength;
          fpvOffsetX = lerp(fpvOffsetX, desiredX, offsetAlpha);
          fpvOffsetY = lerp(fpvOffsetY, desiredY, offsetAlpha);
        } else {
          const decayAlpha = 0.1 * trackingStrength;
          fpvOffsetX = lerp(fpvOffsetX, 0, decayAlpha);
          fpvOffsetY = lerp(fpvOffsetY, 0, decayAlpha);
        }

        const maxScale = Math.min(1.5, Math.max(1, elevationMeters / 15_000));
        const maxOffset = 0.45 * maxScale * Math.min(canvasW, canvasH);
        fpvOffsetX = Math.max(-maxOffset, Math.min(maxOffset, fpvOffsetX));
        fpvOffsetY = Math.max(-maxOffset, Math.min(maxOffset, fpvOffsetY));

        const currentBearing = map.getBearing();
        const bearingToCurrent =
          ((prevBearing - currentBearing + 540) % 360) - 180;
        const newMapBearing =
          currentBearing +
          bearingToCurrent * FPV_BEARING_ALPHA * trackingStrength;

        const pitchAlpha = 0.05 * trackingStrength;
        const newPitch = lerp(currentPitch, FPV_PITCH, pitchAlpha);

        programmaticMove = true;
        try {
          map.easeTo({
            center: [
              lerpLng(center.lng, targetLng, centerAlpha),
              lerp(center.lat, targetLat, centerAlpha),
            ],
            bearing: newMapBearing,
            zoom: smoothZoom,
            pitch: newPitch,
            offset: [fpvOffsetX, fpvOffsetY],
            duration: 0,
            animate: false,
            essential: true,
          });
        } finally {
          programmaticMove = false;
        }
      }

      frameId = requestAnimationFrame(keepInFrame);
    }

    startupTimer = setTimeout(() => {
      startupTimer = null;
      frameId = requestAnimationFrame(keepInFrame);
    }, FPV_FLY_DURATION + 300);

    return () => {
      if (startupTimer) clearTimeout(startupTimer);
      if (frameId != null) cancelAnimationFrame(frameId);
      for (const t of interactionEventTypes) {
        map.off(t, onMapInteraction);
      }
      if (map && isFpvActiveRef.current) {
        setMapInteractionsEnabled(map, true);
        isFpvActiveRef.current = false;
      }
    };
  }, [map, isLoaded, fpvFlight?.icao24, city]);

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
        const easeFactor = smoothstep(t);
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

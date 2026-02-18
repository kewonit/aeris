"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./map";
import {
  FPV_DISTANCE_ZOOM_OFFSET,
  fpvZoomForAltitude,
  lerp,
  lerpLng,
  normalizeLng,
  setMapInteractionsEnabled,
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
}: {
  city: City;
  followFlight?: FlightState | null;
  fpvFlight?: FlightState | null;
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

    const bearing = fpv.trueTrack ?? map.getBearing();
    const zoom =
      fpvZoomForAltitude(fpv.baroAltitude ?? 5000) - FPV_DISTANCE_ZOOM_OFFSET;
    const fpvPitch = map.getPitch();

    const centerLng = ((fpv.longitude + 540) % 360) - 180;

    map.flyTo({
      center: [centerLng, fpv.latitude],
      zoom,
      pitch: fpvPitch,
      bearing,
      duration: FPV_FLY_DURATION,
      essential: true,
    });

    let frameId: number | null = null;

    function keepInFrame() {
      if (!isFpvActiveRef.current || !map) {
        frameId = null;
        return;
      }

      const live = fpvFlightRef.current;
      if (live?.longitude != null && live?.latitude != null) {
        if (
          !Number.isFinite(live.longitude) ||
          !Number.isFinite(live.latitude) ||
          Math.abs(live.latitude) > 90
        ) {
          frameId = requestAnimationFrame(keepInFrame);
          return;
        }

        const point = map.project([
          normalizeLng(live.longitude),
          live.latitude,
        ]);
        const canvas = map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (width < 2 || height < 2) {
          frameId = requestAnimationFrame(keepInFrame);
          return;
        }

        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          frameId = requestAnimationFrame(keepInFrame);
          return;
        }

        const minX = width * 0.18;
        const maxX = width * 0.82;
        const minY = height * 0.18;
        const maxY = height * 0.82;

        const outOfFrame =
          point.x < minX || point.x > maxX || point.y < minY || point.y > maxY;

        if (outOfFrame) {
          const overflowX =
            point.x < minX
              ? minX - point.x
              : point.x > maxX
                ? point.x - maxX
                : 0;
          const overflowY =
            point.y < minY
              ? minY - point.y
              : point.y > maxY
                ? point.y - maxY
                : 0;
          const overflowRatio = Math.max(overflowX / width, overflowY / height);
          const alpha = Math.min(0.12, 0.03 + overflowRatio * 0.2);

          const center = map.getCenter();
          const targetLng = normalizeLng(live.longitude);
          const targetLat = live.latitude;
          map.jumpTo({
            center: [
              lerpLng(center.lng, targetLng, alpha),
              lerp(center.lat, targetLat, alpha),
            ],
          });
        }
      }

      frameId = requestAnimationFrame(keepInFrame);
    }

    frameId = requestAnimationFrame(keepInFrame);

    return () => {
      if (frameId != null) cancelAnimationFrame(frameId);
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

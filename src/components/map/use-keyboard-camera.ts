"use client";

import { useEffect, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";

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

export function useKeyboardCamera(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  isFpvActiveRef: MutableRefObject<boolean>,
  isInteractingRef: MutableRefObject<boolean>,
  idleTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
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
}

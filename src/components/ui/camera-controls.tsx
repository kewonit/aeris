"use client";

import { memo, useCallback, useRef, useEffect, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { PRESS_SCALE } from "@/lib/motion";
import {
  Plus,
  Minus,
  ChevronsUp,
  ChevronsDown,
  RotateCw,
  RotateCcw,
} from "lucide-react";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { useIdle } from "@/hooks/use-idle";

/** The camera buttons fade after the pointer has rested this long. */
const IDLE_HIDE_MS = 3_000;

type CameraActionType = "zoom" | "pitch" | "bearing";

function dispatchCameraStart(type: CameraActionType, direction: number) {
  window.dispatchEvent(
    new CustomEvent("aeris:camera-start", { detail: { type, direction } }),
  );
}

function dispatchCameraStop(type: CameraActionType) {
  window.dispatchEvent(
    new CustomEvent("aeris:camera-stop", { detail: { type } }),
  );
}

function useCameraAction(type: CameraActionType, direction: number) {
  const activeRef = useRef(false);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    dispatchCameraStart(type, direction);
  }, [type, direction]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    dispatchCameraStop(type);
  }, [type]);

  useEffect(
    () => () => {
      if (activeRef.current) dispatchCameraStop(type);
    },
    [type],
  );

  // Held keys move the camera the way a held button does: Enter or Space
  // down starts the move, up ends it.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      start();
    },
    [start],
  );
  const onKeyUp = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      stop();
    },
    [stop],
  );

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onKeyDown,
    onKeyUp,
    onBlur: stop,
  };
}

function ControlButton({
  type,
  direction,
  label,
  hint,
  children,
}: {
  type: CameraActionType;
  direction: number;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const handlers = useCameraAction(type, direction);

  return (
    <Tooltip label={label} hint={hint} side="left">
      <motion.button
        type="button"
        className="grid size-9 place-items-center rounded-full select-none text-subtle transition-colors hover:text-foreground"
        whileTap={{ scale: PRESS_SCALE }}
        aria-label={label}
        onPointerDown={handlers.onPointerDown}
        onPointerUp={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
        onKeyDown={handlers.onKeyDown}
        onKeyUp={handlers.onKeyUp}
        onBlur={handlers.onBlur}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

function Divider() {
  return (
    <div
      className="mx-auto my-1 h-px w-5 bg-border"
    />
  );
}

export function shouldRenderFullscreenToggle(
  mounted: boolean,
  supported: boolean,
) {
  return mounted && supported;
}

function subscribeFullscreen(onStoreChange: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("fullscreenchange", onStoreChange);
  return () => document.removeEventListener("fullscreenchange", onStoreChange);
}

function subscribeNoop() {
  return () => {};
}

function getClientMountedSnapshot() {
  return true;
}

function getServerFullscreenSnapshot() {
  return false;
}

function getFullscreenSnapshot() {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

function getFullscreenSupportedSnapshot() {
  return typeof document !== "undefined" && !!document.fullscreenEnabled;
}

export function useGeolocation() {
  const [locating, setLocating] = useState(false);

  const flyToMe = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        window.dispatchEvent(
          new CustomEvent("aeris:geolocate", {
            detail: {
              coordinates: [pos.coords.longitude, pos.coords.latitude] as [
                number,
                number,
              ],
            },
          }),
        );
      },
      () => {
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  return { flyToMe, locating };
}

export function useFullscreen() {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getClientMountedSnapshot,
    getServerFullscreenSnapshot,
  );
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    getFullscreenSnapshot,
    getServerFullscreenSnapshot,
  );
  const supported = useSyncExternalStore(
    subscribeFullscreen,
    getFullscreenSupportedSnapshot,
    getServerFullscreenSnapshot,
  );

  const toggle = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  return { isFullscreen, toggle, supported, mounted };
}

/**
 * Zoom, tilt and turn, for a mouse. They fade away while the pointer rests
 * and are not shown on touch screens, where fingers do all three.
 */
export const CameraControls = memo(function CameraControls({ autoHide = false }: { autoHide?: boolean }) {
  const idle = useIdle(IDLE_HIDE_MS);
  const hidden = autoHide && idle;
  return (
    <div
      className={`flex flex-col items-center aeris-float rounded-full py-1 transition-opacity duration-300 pointer-coarse:hidden ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      role="toolbar"
      aria-label="Camera"
      aria-hidden={hidden || undefined}
    >
      <TooltipProvider>
        <ControlButton type="zoom" direction={1} label="Zoom in">
          <Plus className="size-4" />
        </ControlButton>
        <ControlButton type="zoom" direction={-1} label="Zoom out">
          <Minus className="size-4" />
        </ControlButton>
        <Divider />
        <ControlButton type="pitch" direction={-1} label="Tilt up" hint="Flatter view">
          <ChevronsUp className="size-4" />
        </ControlButton>
        <ControlButton type="pitch" direction={1} label="Tilt down" hint="More 3D">
          <ChevronsDown className="size-4" />
        </ControlButton>
        <Divider />
        <ControlButton type="bearing" direction={-1} label="Turn right">
          <RotateCw className="size-4" />
        </ControlButton>
        <ControlButton type="bearing" direction={1} label="Turn left">
          <RotateCcw className="size-4" />
        </ControlButton>
      </TooltipProvider>
    </div>
  );
});

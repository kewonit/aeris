"use client";

import {
  useCallback,
  useRef,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { motion } from "motion/react";
import {
  Plus,
  Minus,
  ChevronsUp,
  ChevronsDown,
  RotateCw,
  RotateCcw,
  Locate,
  Maximize,
  Minimize,
} from "lucide-react";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";

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

  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop };
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
        className="flex h-8 w-8 items-center justify-center select-none text-subtle"
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.88 }}
        aria-label={label}
        onPointerDown={handlers.onPointerDown}
        onPointerUp={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
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
      className="mx-auto h-px w-4 bg-card"
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

/** One-off action button (no continuous press). */
function ActionButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} hint={hint} side="left">
      <motion.button
        type="button"
        className="flex h-8 w-8 items-center justify-center select-none text-subtle"
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.88 }}
        aria-label={label}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

function useGeolocation() {
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

function useFullscreen() {
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

export function CameraControls() {
  const { flyToMe, locating } = useGeolocation();
  const {
    isFullscreen,
    toggle: toggleFullscreen,
    supported: fsSupported,
    mounted,
  } = useFullscreen();
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 24,
        delay: 0.55,
      }}
      className="flex flex-col items-center rounded-lg border border-border bg-background"
      role="toolbar"
      aria-label="Camera controls"
    >
      <TooltipProvider>
        <ControlButton type="zoom" direction={1} label="Zoom in">
          <Plus className="h-3.5 w-3.5" />
        </ControlButton>
        <Divider />
        <ControlButton
          type="zoom"
          direction={-1}
          label="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </ControlButton>

        <div
          className="mx-auto my-0.5 h-px w-6 bg-border"
        />

        <ControlButton
          type="pitch"
          direction={-1}
          label="Tilt up"
          hint="Flatter view"
        >
          <ChevronsUp className="h-3.5 w-3.5" />
        </ControlButton>
        <Divider />
        <ControlButton
          type="pitch"
          direction={1}
          label="Tilt down"
          hint="More 3D"
        >
          <ChevronsDown className="h-3.5 w-3.5" />
        </ControlButton>

        <div
          className="mx-auto my-0.5 h-px w-6 bg-border"
        />

        <ControlButton
          type="bearing"
          direction={-1}
          label="Rotate clockwise"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </ControlButton>
        <Divider />
        <ControlButton
          type="bearing"
          direction={1}
          label="Rotate counter-clockwise"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </ControlButton>

        <div
          className="mx-auto my-0.5 h-px w-6 bg-border"
        />

        <ActionButton
          label="Fly to my location"
          hint={locating ? "Finding you…" : undefined}
          onClick={flyToMe}
        >
          <Locate className={`h-3.5 w-3.5 ${locating ? "animate-pulse" : ""}`} />
        </ActionButton>

        {shouldRenderFullscreenToggle(mounted, fsSupported) && (
          <>
            <Divider />
            <ActionButton
              label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize className="h-3.5 w-3.5" />
              ) : (
                <Maximize className="h-3.5 w-3.5" />
              )}
            </ActionButton>
          </>
        )}
      </TooltipProvider>
    </motion.div>
  );
}

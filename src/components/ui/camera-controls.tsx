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
  title,
  children,
}: {
  type: CameraActionType;
  direction: number;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  const handlers = useCameraAction(type, direction);

  return (
    <motion.button
      type="button"
      className="flex h-8 w-8 items-center justify-center select-none"
      style={{ color: "rgb(var(--ui-fg) / 0.45)" }}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.88 }}
      aria-label={label}
      title={title}
      onPointerDown={handlers.onPointerDown}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </motion.button>
  );
}

function Divider() {
  return (
    <div
      className="mx-auto h-px w-4"
      style={{ backgroundColor: "rgb(var(--ui-fg) / 0.06)" }}
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
  title,
  onClick,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      className="flex h-8 w-8 items-center justify-center select-none"
      style={{ color: "rgb(var(--ui-fg) / 0.45)" }}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.88 }}
      aria-label={label}
      title={title}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </motion.button>
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
      className="flex flex-col items-center rounded-xl border backdrop-blur-2xl"
      style={{
        borderColor: "rgb(var(--ui-fg) / 0.06)",
        backgroundColor: "rgb(var(--ui-bg) / 0.5)",
      }}
      role="toolbar"
      aria-label="Camera controls"
    >
      <ControlButton type="zoom" direction={1} label="Zoom in" title="Zoom in">
        <Plus className="h-3.5 w-3.5" />
      </ControlButton>
      <Divider />
      <ControlButton
        type="zoom"
        direction={-1}
        label="Zoom out"
        title="Zoom out"
      >
        <Minus className="h-3.5 w-3.5" />
      </ControlButton>

      <div
        className="mx-auto my-0.5 h-px w-6"
        style={{ backgroundColor: "rgb(var(--ui-fg) / 0.10)" }}
      />

      <ControlButton
        type="pitch"
        direction={-1}
        label="Tilt up"
        title="Tilt up (flatter view)"
      >
        <ChevronsUp className="h-3.5 w-3.5" />
      </ControlButton>
      <Divider />
      <ControlButton
        type="pitch"
        direction={1}
        label="Tilt down"
        title="Tilt down (more 3D)"
      >
        <ChevronsDown className="h-3.5 w-3.5" />
      </ControlButton>

      <div
        className="mx-auto my-0.5 h-px w-6"
        style={{ backgroundColor: "rgb(var(--ui-fg) / 0.10)" }}
      />

      <ControlButton
        type="bearing"
        direction={1}
        label="Rotate clockwise"
        title="Rotate clockwise"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </ControlButton>
      <Divider />
      <ControlButton
        type="bearing"
        direction={-1}
        label="Rotate counter-clockwise"
        title="Rotate counter-clockwise"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </ControlButton>

      <div
        className="mx-auto my-0.5 h-px w-6"
        style={{ backgroundColor: "rgb(var(--ui-fg) / 0.10)" }}
      />

      <ActionButton
        label="Fly to my location"
        title="Fly to my location"
        onClick={flyToMe}
      >
        <Locate className={`h-3.5 w-3.5 ${locating ? "animate-pulse" : ""}`} />
      </ActionButton>

      {shouldRenderFullscreenToggle(mounted, fsSupported) && (
        <>
          <Divider />
          <ActionButton
            label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
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
    </motion.div>
  );
}

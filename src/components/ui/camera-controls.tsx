"use client";

import { useCallback, useRef, useEffect } from "react";
import { motion } from "motion/react";
import {
  Plus,
  Minus,
  ChevronsUp,
  ChevronsDown,
  RotateCw,
  RotateCcw,
} from "lucide-react";

type CameraActionType = "zoom" | "pitch" | "bearing";

function dispatchCameraStart(type: CameraActionType, direction: number) {
  window.dispatchEvent(
    new CustomEvent("aeris-mercosul:camera-start", { detail: { type, direction } }),
  );
}

function dispatchCameraStop(type: CameraActionType) {
  window.dispatchEvent(
    new CustomEvent("aeris-mercosul:camera-stop", { detail: { type } }),
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

export function CameraControls() {
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
    </motion.div>
  );
}

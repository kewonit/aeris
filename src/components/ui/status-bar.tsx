"use client";

import { motion, AnimatePresence } from "motion/react";
import { Compass, Plane, Radio, ShieldAlert } from "lucide-react";

type StatusBarProps = {
  flightCount: number;
  cityName: string;
  loading: boolean;
  rateLimited?: boolean;
  retryIn?: number;
  onNorthUp?: () => void;
  onResetView?: () => void;
};

export function StatusBar({
  flightCount,
  cityName,
  loading,
  rateLimited = false,
  retryIn = 0,
  onNorthUp,
  onResetView,
}: StatusBarProps) {
  return (
    <div className="flex flex-col items-start gap-2">
      <AnimatePresence>
        {rateLimited && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="flex items-center gap-2.5 rounded-xl border border-amber-500/15 bg-amber-500/6 px-3.5 py-2 backdrop-blur-2xl"
            role="alert"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400/80" />
            <span className="text-[11px] font-medium tracking-wide text-amber-300/70">
              Rate limited
            </span>
            {retryIn > 0 && (
              <>
                <div className="h-3 w-px bg-amber-400/10" />
                <span className="font-mono text-[11px] font-semibold tabular-nums text-amber-400/60">
                  {retryIn}s
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 24,
            delay: 0.4,
          }}
          className="flex items-center gap-3 rounded-xl border px-3.5 py-2 backdrop-blur-2xl"
          style={{
            borderColor: "rgb(var(--ui-fg) / 0.06)",
            backgroundColor: "rgb(var(--ui-bg) / 0.5)",
          }}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex items-center gap-2">
            <div className="relative">
              <Radio
                className={`h-3 w-3 ${rateLimited ? "text-amber-400/80" : "text-emerald-400/80"}`}
              />
            </div>
            <span
              className="text-[11px] font-medium tracking-wide"
              style={{ color: "rgb(var(--ui-fg) / 0.4)" }}
            >
              {rateLimited ? "Paused" : loading ? "Scanning..." : "Live"}
            </span>
          </div>

          <div
            className="h-3 w-px"
            style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
          />

          <div className="flex items-center gap-1.5">
            <Plane
              className="h-3 w-3"
              style={{ color: "rgb(var(--ui-fg) / 0.3)" }}
            />
            <span
              className="text-[11px] font-semibold tracking-wide"
              style={{ color: "rgb(var(--ui-fg) / 0.6)" }}
            >
              {flightCount}
            </span>
          </div>

          <div
            className="h-3 w-px"
            style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
          />
          <span
            className="text-[11px] font-medium tracking-wide"
            style={{ color: "rgb(var(--ui-fg) / 0.4)" }}
            title={cityName}
          >
            {cityName}
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 24,
            delay: 0.48,
          }}
          className="flex items-center gap-1.5 rounded-xl border px-2.5 py-2 backdrop-blur-2xl"
          style={{
            borderColor: "rgb(var(--ui-fg) / 0.06)",
            backgroundColor: "rgb(var(--ui-bg) / 0.5)",
          }}
        >
          <button
            type="button"
            onClick={onNorthUp}
            aria-label="North up"
            title="North up"
            className="text-[11px] font-medium tracking-wide transition-colors"
            style={{ color: "rgb(var(--ui-fg) / 0.55)" }}
          >
            <Compass className="h-3 w-3" />
          </button>
          <div
            className="h-3 w-px"
            style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
          />
          <button
            type="button"
            onClick={onResetView}
            className="text-[11px] font-medium tracking-wide transition-colors"
            style={{ color: "rgb(var(--ui-fg) / 0.55)" }}
          >
            Reset
          </button>
        </motion.div>
      </div>
    </div>
  );
}

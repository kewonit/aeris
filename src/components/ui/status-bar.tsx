"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Dices, Plane, ShieldAlert } from "lucide-react";
import {
  AtcTrigger,
  AtcFeedDropdown,
  useAvailableFeeds,
} from "@/components/ui/atc-panel";
import {
  ProviderTrigger,
  ProviderDropdown,
} from "@/components/ui/provider-panel";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";

type StatusBarProps = {
  flightCount: number;
  cityName: string;
  cityIata: string;
  cityCoordinates: [number, number];
  loading: boolean;
  rateLimited?: boolean;
  retryIn?: number;
  onNorthUp?: () => void;
  onResetView?: () => void;
  onRandomAirport?: () => void;
  atc: UseAtcStreamReturn;
  /** Incremented externally to toggle the feed dropdown (e.g. from keyboard shortcut) */
  atcToggle?: number;
  /** Current ADS-B data source (e.g. "adsb", "opensky", "none") */
  source?: string | null;
};

export function StatusBar({
  flightCount,
  cityName,
  cityIata,
  cityCoordinates,
  loading,
  rateLimited = false,
  retryIn = 0,
  onNorthUp,
  onResetView,
  onRandomAirport,
  atc,
  atcToggle,
  source,
}: StatusBarProps) {
  const [feedDropdownOpen, setFeedDropdownOpen] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const availableFeeds = useAvailableFeeds(cityIata, cityCoordinates);
  const prevToggleRef = useRef(atcToggle);

  // React to external toggle (keyboard shortcut)
  useEffect(() => {
    if (atcToggle !== undefined && atcToggle !== prevToggleRef.current) {
      prevToggleRef.current = atcToggle;
      setFeedDropdownOpen((p) => !p);
    }
  }, [atcToggle]);

  const toggleFeedDropdown = useCallback(() => {
    setProviderDropdownOpen(false);
    setFeedDropdownOpen((p) => !p);
  }, []);

  const closeFeedDropdown = useCallback(() => {
    setFeedDropdownOpen(false);
  }, []);

  const toggleProviderDropdown = useCallback(() => {
    setFeedDropdownOpen(false);
    setProviderDropdownOpen((p) => !p);
  }, []);

  const closeProviderDropdown = useCallback(() => {
    setProviderDropdownOpen(false);
  }, []);

  const isAtcPlaying = atc.status === "playing";
  return (
    <div className="relative flex flex-col items-start gap-2">
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
          <ProviderTrigger
            source={source ?? null}
            loading={loading}
            rateLimited={rateLimited}
            onClick={toggleProviderDropdown}
          />

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

          {/* ATC trigger */}
          <AtcTrigger
            hasFeeds={availableFeeds.length > 0}
            isPlaying={isAtcPlaying}
            isError={atc.status === "error" || atc.status === "blocked"}
            onClick={toggleFeedDropdown}
          />
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
          className="flex items-center gap-3 rounded-xl border px-3.5 py-2 backdrop-blur-2xl"
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
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="currentColor"
            >
              <path d="M12 3L4 21l8-4 8 4L12 3z" />
            </svg>
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
          <div
            className="h-3 w-px"
            style={{ backgroundColor: "rgb(var(--ui-fg) / 0.08)" }}
          />
          <button
            type="button"
            onClick={onRandomAirport}
            aria-label="Random airport"
            title="Random airport"
            className="inline-flex items-center gap-1 text-[11px] font-medium tracking-wide transition-colors"
            style={{ color: "rgb(var(--ui-fg) / 0.55)" }}
          >
            <Dices className="h-3 w-3" />
            Random
          </button>
        </motion.div>
      </div>

      {/* Dropdowns — positioned above entire status bar */}
      <ProviderDropdown
        open={providerDropdownOpen}
        onClose={closeProviderDropdown}
        currentSource={source ?? null}
      />
      <AtcFeedDropdown
        feeds={availableFeeds}
        atc={atc}
        open={feedDropdownOpen}
        onClose={closeFeedDropdown}
      />
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
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
import type { RelaySourceStatus } from "@/lib/relay/protocol";

import {
  resolveDropdownState,
  type StatusBarDropdownState,
} from "./status-bar-state";

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
  sourceStatus?: RelaySourceStatus | null;
  sourceAgeMs?: number | null;
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
  sourceStatus,
  sourceAgeMs,
}: StatusBarProps) {
  const [dropdownState, setDropdownState] = useState<StatusBarDropdownState>(
    () => ({
      feedDropdownOpen: false,
      providerDropdownOpen: false,
      handledAtcToggle: atcToggle,
    }),
  );
  const availableFeeds = useAvailableFeeds(cityIata, cityCoordinates);

  const { feedDropdownOpen, providerDropdownOpen } = resolveDropdownState(
    dropdownState,
    atcToggle,
  );

  const toggleFeedDropdown = useCallback(() => {
    setDropdownState((state) => {
      const resolved = resolveDropdownState(state, atcToggle);
      return {
        feedDropdownOpen: !resolved.feedDropdownOpen,
        providerDropdownOpen: false,
        handledAtcToggle: atcToggle ?? state.handledAtcToggle,
      };
    });
  }, [atcToggle]);

  const closeFeedDropdown = useCallback(() => {
    setDropdownState((state) => {
      const resolved = resolveDropdownState(state, atcToggle);
      return {
        ...state,
        ...resolved,
        feedDropdownOpen: false,
        handledAtcToggle: atcToggle ?? state.handledAtcToggle,
      };
    });
  }, [atcToggle]);

  const toggleProviderDropdown = useCallback(() => {
    setDropdownState((state) => {
      const resolved = resolveDropdownState(state, atcToggle);
      return {
        feedDropdownOpen: false,
        providerDropdownOpen: !resolved.providerDropdownOpen,
        handledAtcToggle: atcToggle ?? state.handledAtcToggle,
      };
    });
  }, [atcToggle]);

  const closeProviderDropdown = useCallback(() => {
    setDropdownState((state) => ({
      ...state,
      providerDropdownOpen: false,
      handledAtcToggle: atcToggle ?? state.handledAtcToggle,
    }));
  }, [atcToggle]);

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
            className="flex items-center gap-2.5 rounded-full border border-border bg-background px-3.5 py-2 text-label text-warning"
            role="alert"
          >
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            Rate limited
            {retryIn > 0 && (
              <span className="font-mono text-subtle">retry in {retryIn}s</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:items-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 24,
            delay: 0.4,
          }}
          className="flex items-center gap-3 rounded-lg border px-3.5 py-2 border-border bg-background"
          aria-live="polite"
          aria-atomic="true"
        >
          <ProviderTrigger
            source={source ?? null}
            sourceStatus={sourceStatus}
            sourceAgeMs={sourceAgeMs}
            loading={loading}
            rateLimited={rateLimited}
            onClick={toggleProviderDropdown}
          />

          <div
            className="h-3 w-px bg-border"
          />

          <div className="flex items-center gap-1.5">
            <Plane
              className="h-3 w-3 text-subtle"
            />
            <span
              className="text-caption text-muted-foreground"
            >
              {flightCount}
            </span>
          </div>

          <div
            className="h-3 w-px bg-border"
          />
          <span
            className="text-caption text-subtle"
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
          className="flex items-center gap-3 rounded-lg border px-3.5 py-2 border-border bg-background"
        >
          <button
            type="button"
            onClick={onNorthUp}
            aria-label="North up"
            title="North up"
            className="text-caption transition-colors text-muted-foreground"
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
            className="h-3 w-px bg-border"
          />
          <button
            type="button"
            onClick={onResetView}
            className="text-caption transition-colors text-muted-foreground"
          >
            Reset
          </button>
          <div
            className="h-3 w-px bg-border"
          />
          <button
            type="button"
            onClick={onRandomAirport}
            aria-label="Random airport"
            title="Random airport"
            className="inline-flex items-center gap-1 text-caption transition-colors text-muted-foreground"
          >
            <Dices className="h-3 w-3" />
            Random
          </button>
        </motion.div>
      </div>

      {/* Dropdowns - positioned above entire status bar */}
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

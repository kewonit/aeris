"use client";

import { useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Radio,
  Play,
  Square,
  Loader2,
  X,
  AlertTriangle,
  Server,
  ChevronUp,
} from "lucide-react";
import type { AtcFeed, AtcFeedType } from "@/lib/atc-types";
import { FEED_TYPE_PRIORITY } from "@/lib/atc-types";
import { lookupAtcFeeds, findNearbyAtcFeeds } from "@/lib/atc-lookup";
import { AtcWaveform } from "@/components/ui/atc-waveform";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import { useDropdownDismiss } from "@/hooks/use-dropdown-dismiss";

// ── Feed helpers ───────────────────────────────────────────────────────

const TYPE_LABELS: Record<AtcFeedType, string> = {
  tower: "TWR",
  ground: "GND",
  approach: "APP",
  departure: "DEP",
  atis: "ATIS",
  center: "CTR",
  combined: "CMB",
};

const TYPE_COLORS: Record<AtcFeedType, string> = {
  tower: "rgb(52, 211, 153)",
  ground: "rgb(251, 191, 36)",
  approach: "rgb(96, 165, 250)",
  departure: "rgb(167, 139, 250)",
  atis: "rgb(148, 163, 184)",
  center: "rgb(244, 114, 182)",
  combined: "rgb(156, 163, 175)",
};

function sortFeeds(feeds: AtcFeed[]): AtcFeed[] {
  return [...feeds].sort(
    (a, b) => FEED_TYPE_PRIORITY[a.type] - FEED_TYPE_PRIORITY[b.type],
  );
}

export function useAvailableFeeds(
  cityIata: string,
  cityCoordinates: [number, number],
): AtcFeed[] {
  return useMemo(() => {
    const byCode = lookupAtcFeeds(cityIata);
    if (byCode.length > 0) return sortFeeds(byCode);
    const [lng, lat] = cityCoordinates;
    const nearby = findNearbyAtcFeeds(lat, lng, 30);
    return sortFeeds(nearby.flatMap((r) => r.feeds));
  }, [cityIata, cityCoordinates]);
}

// Waveform is in atc-waveform.tsx

// ── Feed Dropdown (opens upward) ───────────────────────────────────────

export type AtcFeedDropdownProps = {
  feeds: AtcFeed[];
  atc: UseAtcStreamReturn;
  open: boolean;
  onClose: () => void;
};

export function AtcFeedDropdown({
  feeds,
  atc,
  open,
  onClose,
}: AtcFeedDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  useDropdownDismiss(dropdownRef, open, onClose);

  const handleSelectFeed = useCallback(
    (feed: AtcFeed) => {
      if (atc.feed?.id === feed.id && atc.status === "playing") {
        atc.stop();
      } else {
        atc.play(feed);
      }
      onClose();
    },
    [atc, onClose],
  );

  // Group feeds by type for visual hierarchy
  const groupedFeeds = useMemo(() => {
    const groups: { type: AtcFeedType; label: string; feeds: AtcFeed[] }[] = [];
    const typeOrder: AtcFeedType[] = [
      "tower",
      "ground",
      "approach",
      "departure",
      "center",
      "atis",
      "combined",
    ];
    for (const type of typeOrder) {
      const matching = feeds.filter((f) => f.type === type);
      if (matching.length > 0) {
        groups.push({ type, label: TYPE_LABELS[type], feeds: matching });
      }
    }
    return groups;
  }, [feeds]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute bottom-full left-0 z-50 mb-2 w-[calc(100vw-2rem)] max-w-70 overflow-hidden rounded-xl border shadow-2xl shadow-black/60 backdrop-blur-2xl sm:w-70 sm:max-w-none"
          style={{
            borderColor: "rgb(var(--ui-fg) / 0.08)",
            backgroundColor: "rgb(var(--ui-bg) / 0.75)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: "1px solid rgb(var(--ui-fg) / 0.06)" }}
          >
            <div className="flex items-center gap-2">
              <Radio className="h-3 w-3 text-emerald-400/70" />
              <span
                className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: "rgb(var(--ui-fg) / 0.35)" }}
              >
                Frequencies
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-white/5 active:bg-white/10"
              aria-label="Close feed selector"
            >
              <X
                className="h-3 w-3"
                style={{ color: "rgb(var(--ui-fg) / 0.3)" }}
              />
            </button>
          </div>

          {/* Feed list */}
          {feeds.length === 0 ? (
            <div className="px-3.5 py-5 text-center">
              <span
                className="text-[10px]"
                style={{ color: "rgb(var(--ui-fg) / 0.3)" }}
              >
                No feeds for this area
              </span>
            </div>
          ) : (
            <div className="max-h-65 overflow-y-auto py-1">
              {groupedFeeds.map((group) => (
                <div key={group.type}>
                  {group.feeds.map((feed) => {
                    const isPlaying =
                      atc.feed?.id === feed.id && atc.status === "playing";
                    const isLoading =
                      atc.feed?.id === feed.id && atc.status === "loading";
                    const isFeedError =
                      atc.feed?.id === feed.id &&
                      (atc.status === "error" || atc.status === "blocked");
                    const isSelected = atc.feed?.id === feed.id;

                    return (
                      <button
                        key={feed.id}
                        type="button"
                        onClick={() => handleSelectFeed(feed)}
                        className={`group flex w-full items-center gap-2.5 px-3.5 py-2 transition-colors ${
                          isSelected
                            ? "bg-white/6"
                            : "hover:bg-white/3 active:bg-white/6"
                        }`}
                      >
                        {/* Inline icon */}
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {isLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin text-emerald-400/70" />
                          ) : isFeedError ? (
                            <AlertTriangle className="h-3 w-3 text-amber-400/70" />
                          ) : isPlaying ? (
                            <Square className="h-2.5 w-2.5 text-emerald-400" />
                          ) : (
                            <Play
                              className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-80"
                              style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
                            />
                          )}
                        </div>

                        {/* Feed name + frequency */}
                        <div className="flex min-w-0 flex-1 flex-col gap-0 text-left">
                          <span
                            className="truncate text-[11px] font-medium leading-snug"
                            style={{
                              color: isPlaying
                                ? "rgb(var(--ui-fg) / 0.85)"
                                : isFeedError
                                  ? "rgb(251 191 36 / 0.7)"
                                  : "rgb(var(--ui-fg) / 0.55)",
                            }}
                          >
                            {feed.name}
                          </span>
                          {isFeedError && atc.error ? (
                            <span className="truncate text-[9px] text-amber-300/50">
                              {atc.error}
                            </span>
                          ) : (
                            <span
                              className="font-mono text-[9px] tabular-nums leading-snug"
                              style={{ color: "rgb(var(--ui-fg) / 0.25)" }}
                            >
                              {feed.frequency}
                            </span>
                          )}
                        </div>

                        {/* Type badge */}
                        <span
                          className="shrink-0 rounded px-1.5 py-px text-[8px] font-bold tracking-wider"
                          style={{
                            backgroundColor: `${TYPE_COLORS[feed.type]}12`,
                            color: `${TYPE_COLORS[feed.type]}`,
                          }}
                        >
                          {TYPE_LABELS[feed.type]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Bottom Player Bar (ElevenLabs-style) ───────────────────────────────

export type AtcPlayerBarProps = {
  atc: UseAtcStreamReturn;
  onOpenFeedSelector: () => void;
};

export function AtcPlayerBar({ atc, onOpenFeedSelector }: AtcPlayerBarProps) {
  const isStreaming = atc.status === "playing" || atc.status === "loading";
  const isError = atc.status === "error" || atc.status === "blocked";
  const isBlocked = atc.status === "blocked";

  if (!atc.feed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className="flex w-[calc(100vw-2rem)] max-w-sm items-center gap-3 rounded-2xl border px-3.5 py-3 backdrop-blur-2xl sm:w-auto sm:max-w-none sm:gap-3.5 sm:px-4"
      style={{
        borderColor: isError
          ? "rgb(251 191 36 / 0.12)"
          : "rgb(var(--ui-fg) / 0.06)",
        backgroundColor: "rgb(var(--ui-bg) / 0.5)",
      }}
    >
      {/* Waveform or blocked play icon (left) */}
      {isBlocked ? (
        <button
          type="button"
          onClick={() => atc.resume()}
          className="flex h-7 w-13 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/5 active:bg-white/10"
          aria-label="Tap to start"
        >
          <Play className="h-4 w-4 text-emerald-400/80" />
        </button>
      ) : (
        <AtcWaveform
          audioElement={atc.audioElement}
          active={atc.status === "playing"}
        />
      )}

      {/* Feed name + frequency (stacked, center) — clickable to open selector */}
      <button
        type="button"
        onClick={isBlocked ? () => atc.resume() : onOpenFeedSelector}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
      >
        <div className="flex items-center gap-1.5">
          {atc.status === "loading" ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-emerald-400/70" />
          ) : isError ? (
            <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400/70" />
          ) : null}
          <span
            className="truncate text-[12px] font-medium leading-tight"
            style={{
              color: isBlocked
                ? "rgb(var(--ui-fg) / 0.55)"
                : isError
                  ? "rgb(251 191 36 / 0.7)"
                  : isStreaming
                    ? "rgb(var(--ui-fg) / 0.75)"
                    : "rgb(var(--ui-fg) / 0.45)",
            }}
          >
            {isBlocked
              ? "Tap to listen"
              : isError && atc.error
                ? atc.error
                : atc.feed.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-[9px] tabular-nums"
            style={{ color: "rgb(var(--ui-fg) / 0.25)" }}
          >
            {atc.feed.frequency}
          </span>
          {atc.usingProxy && atc.status === "playing" && (
            <span
              className="flex items-center gap-0.5 text-[9px]"
              style={{ color: "rgb(var(--ui-fg) / 0.2)" }}
            >
              <Server className="h-1.5 w-1.5" />
              proxy
            </span>
          )}
        </div>
      </button>

      {/* Close / Stop (right) */}
      <button
        type="button"
        onClick={() => atc.stop()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/5 active:bg-white/10"
        aria-label="Stop and close"
      >
        <X
          className="h-3.5 w-3.5"
          style={{ color: "rgb(var(--ui-fg) / 0.25)" }}
        />
      </button>
    </motion.div>
  );
}

// ── Status Bar ATC Trigger Button ──────────────────────────────────────

export type AtcTriggerProps = {
  hasFeeds: boolean;
  isPlaying: boolean;
  isError: boolean;
  onClick: () => void;
};

export function AtcTrigger({
  hasFeeds,
  isPlaying,
  isError,
  onClick,
}: AtcTriggerProps) {
  if (!hasFeeds) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded p-1 transition-colors hover:bg-white/5 active:bg-white/10 sm:p-0.5"
      aria-label="Live ATC (A)"
      title="Live ATC (A)"
    >
      <ChevronUp
        className={`h-3 w-3 transition-colors ${isError ? "animate-pulse" : ""}`}
        style={{
          color: isPlaying
            ? "rgb(52, 211, 153)"
            : isError
              ? "rgb(251, 191, 36)"
              : "rgb(var(--ui-fg) / 0.35)",
        }}
      />
    </button>
  );
}

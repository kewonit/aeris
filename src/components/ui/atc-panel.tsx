"use client";

import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
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
  AudioLines,
} from "lucide-react";
import type { AtcFeed, AtcFeedType } from "@/lib/atc-types";
import { FEED_TYPE_PRIORITY } from "@/lib/atc-types";
import { lookupAtcFeeds, findNearbyAtcFeeds } from "@/lib/atc-lookup";
import { AtcWaveform } from "@/components/ui/atc-waveform";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import { useDropdownDismiss } from "@/hooks/use-dropdown-dismiss";
import { ScrollArea } from "@/components/ui/scroll-area";

const AtcSpectrum = dynamic(
  () =>
    import("@/components/ui/atc-spectrum").then((mod) => mod.AtcSpectrum),
  { ssr: false },
);

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
          className="absolute bottom-full left-0 z-50 mb-2 w-[calc(100vw-2rem)] max-w-70 overflow-hidden rounded-lg border border-border bg-background shadow-lift sm:w-70 sm:max-w-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border py-1 pr-1 pl-4">
            <div className="flex items-center gap-2 text-label text-subtle">
              <Radio className="size-3" aria-hidden="true" />
              Frequencies
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-full text-subtle transition-colors hover:bg-card hover:text-foreground"
              aria-label="Close feed selector"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Feed list */}
          {feeds.length === 0 ? (
            <p className="px-4 py-5 text-center text-small text-subtle">
              No feeds for this area
            </p>
          ) : (
            <ScrollArea className="max-h-65">
              <div className="py-1">
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
                          className={`group flex w-full items-center gap-2.5 px-4 py-2 transition-colors ${
                            isSelected ? "bg-card" : "hover:bg-card"
                          }`}
                        >
                          {/* Inline icon */}
                          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {isLoading ? (
                              <Loader2 className="size-3 animate-spin text-subtle" />
                            ) : isFeedError ? (
                              <AlertTriangle className="size-3 text-warning" />
                            ) : isPlaying ? (
                              <Square className="size-2.5 text-tint" />
                            ) : (
                              <Play className="size-3 text-subtle transition-colors group-hover:text-foreground" />
                            )}
                          </div>

                          {/* Feed name + frequency */}
                          <div className="flex min-w-0 flex-1 flex-col text-left">
                            <span
                              className={`truncate text-small ${
                                isPlaying
                                  ? "text-foreground"
                                  : isFeedError
                                    ? "text-warning"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {feed.name}
                            </span>
                            <span
                              className={`truncate font-mono text-micro ${isFeedError && atc.error ? "text-warning" : "text-subtle"}`}
                            >
                              {isFeedError && atc.error ? atc.error : feed.frequency}
                            </span>
                          </div>

                          <span className="shrink-0 font-mono text-micro text-subtle">
                            {TYPE_LABELS[feed.type]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </ScrollArea>
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
  const [spectrumOpen, setSpectrumOpen] = useState(false);

  // Close spectrum on Escape key
  useEffect(() => {
    if (!spectrumOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSpectrumOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [spectrumOpen]);

  if (!atc.feed) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Expanded Spectrum Visualizer */}
      <AnimatePresence>
        {spectrumOpen && (
          <div className="w-[calc(100vw-2rem)] max-w-sm sm:w-96 sm:max-w-none">
            <AtcSpectrum
              audioElement={atc.audioElement}
              active={atc.status === "playing"}
              feedName={atc.feed.name}
              feedFrequency={atc.feed.frequency}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Player Bar */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="flex w-[calc(100vw-2rem)] max-w-sm items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 shadow-lift sm:w-auto sm:max-w-none"
      >
        {/* Waveform or blocked play icon (left) */}
        {isBlocked ? (
          <button
            type="button"
            onClick={() => atc.resume()}
            className="flex h-7 w-13 shrink-0 items-center justify-center rounded-sm text-tint transition-colors hover:bg-card"
            aria-label="Tap to start"
          >
            <Play className="size-4" />
          </button>
        ) : (
          <AtcWaveform
            audioElement={atc.audioElement}
            active={atc.status === "playing"}
          />
        )}

        {/* Feed name + frequency (stacked, center) - clickable to open selector */}
        <button
          type="button"
          onClick={isBlocked ? () => atc.resume() : onOpenFeedSelector}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        >
          <div className="flex items-center gap-1.5">
            {atc.status === "loading" ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-subtle" />
            ) : isError ? (
              <AlertTriangle className="size-3 shrink-0 text-warning" />
            ) : null}
            <span
              className={`truncate text-small ${
                isError && !isBlocked
                  ? "text-warning"
                  : isStreaming
                    ? "text-foreground"
                    : "text-muted-foreground"
              }`}
            >
              {isBlocked
                ? "Tap to listen"
                : isError && atc.error
                  ? atc.error
                  : atc.feed.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-micro text-subtle">
              {atc.feed.frequency}
            </span>
            {atc.usingProxy && atc.status === "playing" && (
              <span className="flex items-center gap-0.5 text-micro text-subtle">
                <Server className="size-2" aria-hidden="true" />
                proxy
              </span>
            )}
          </div>
        </button>

        {/* Spectrum toggle (right of center) */}
        {!isBlocked && (
          <button
            type="button"
            onClick={() => setSpectrumOpen((prev) => !prev)}
            className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-card ${spectrumOpen ? "text-tint" : "text-subtle hover:text-foreground"}`}
            aria-label={spectrumOpen ? "Hide spectrum" : "Show spectrum"}
            aria-pressed={spectrumOpen}
          >
            <AudioLines className="size-3.5" />
          </button>
        )}

        {/* Close / Stop (right) */}
        <button
          type="button"
          onClick={() => atc.stop()}
          className="grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-card hover:text-foreground"
          aria-label="Stop and close"
        >
          <X className="size-3.5" />
        </button>
      </motion.div>
    </div>
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
      className={`inline-flex items-center rounded-sm p-1 transition-colors hover:bg-card ${
        isPlaying ? "text-tint" : isError ? "text-warning" : "text-subtle"
      }`}
      aria-label="Live ATC (A)"
    >
      <ChevronUp className="size-3" />
    </button>
  );
}

"use client";

import { memo, useState, useCallback } from "react";
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
  atc: UseAtcStreamReturn;
  /** Incremented externally to toggle the feed dropdown (e.g. from keyboard shortcut) */
  atcToggle?: number;
  /** Current ADS-B data source (e.g. "adsb", "opensky", "none") */
  source?: string | null;
};

export const StatusBar = memo(function StatusBar({
  flightCount,
  cityName,
  cityIata,
  cityCoordinates,
  loading,
  rateLimited = false,
  retryIn = 0,
  atc,
  atcToggle,
  source,
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
      <div className="aeris-float aeris-glass flex h-11 max-w-[calc(100vw-10rem)] items-center rounded-full px-1 text-label sm:max-w-none">
        {/* The page's one heading: the name, shown on a desktop. */}
        <h1 className="sr-only sm:not-sr-only">
          <span className="aeris-wordmark block pr-1 pl-3 text-muted-foreground">aeris</span>
        </h1>
        <ProviderTrigger
          source={source ?? null}
          loading={loading}
          rateLimited={rateLimited}
          retryIn={retryIn}
          flightCount={flightCount}
          cityName={cityName}
          onClick={toggleProviderDropdown}
        />
        <AtcTrigger
          hasFeeds={availableFeeds.length > 0}
          isPlaying={isAtcPlaying}
          isError={atc.status === "error" || atc.status === "blocked"}
          onClick={toggleFeedDropdown}
        />
      </div>
      {/* Only the place and the feed are announced, not every poll's count. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {cityName}
      </p>

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
});

"use client";

import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SNAP } from "@/lib/motion";
import { Satellite, X, Circle } from "lucide-react";
import {
  getCircuitState,
  getProviderOverride,
  setProviderOverride,
  type CircuitState,
} from "@/lib/flight-api-client";
import type { ProviderName } from "@/lib/flight-api";
import { useDropdownDismiss } from "@/hooks/use-dropdown-dismiss";

// ── Provider definitions ───────────────────────────────────────────────

interface ProviderInfo {
  id: ProviderName;
  label: string;
  description: string;
}

const PROVIDERS: ProviderInfo[] = [
  { id: "adsb", label: "adsb.lol", description: "" },
  { id: "adsbfi", label: "adsb.fi", description: "" },
  { id: "airplanes", label: "Airplanes.live", description: "" },
  {
    id: "opensky",
    label: "OpenSky",
    description: "Backup · limited",
  },
];

const SOURCE_LABELS: Record<string, string> = {
  adsb: "adsb.lol",
  adsbfi: "adsb.fi",
  opensky: "OpenSky",
  airplanes: "Airplanes.live",
  none: "Unavailable",
};

/** Circuit breaker state, shown only when a provider is cooling down or probing. */
function circuitLabel(state: CircuitState, cooldownMs: number): string | null {
  if (state === "open") return `Retry in ${Math.ceil(cooldownMs / 1000)}s`;
  if (state === "half-open") return "Retrying";
  return null;
}

// ── Provider Dropdown ──────────────────────────────────────────────────

export type ProviderDropdownProps = {
  open: boolean;
  onClose: () => void;
  currentSource: string | null;
};

export function ProviderDropdown({
  open,
  onClose,
  currentSource,
}: ProviderDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  useDropdownDismiss(dropdownRef, open, onClose);

  const [override, setOverride] = useState(() => getProviderOverride());
  const isAutoMode = override === "auto";

  const handleSelect = useCallback(
    (provider: ProviderName | "auto") => {
      setProviderOverride(provider);
      setOverride(provider === "auto" ? "auto" : provider);
      onClose();
    },
    [onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={SNAP}
          className="absolute bottom-full left-0 z-50 mb-2 w-[calc(100vw-2rem)] max-w-70 overflow-hidden rounded-lg border border-border bg-background shadow-lift sm:w-70 sm:max-w-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border py-1 pr-1 pl-4">
            <div className="flex items-center gap-2 text-label text-subtle">
              <Satellite className="size-3" aria-hidden="true" />
              Flight feed
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-full text-subtle transition-colors hover:bg-card hover:text-foreground"
              aria-label="Close provider selector"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Provider list */}
          <div className="py-1">
            <ProviderOption
              label="Auto"
              description="The fastest feed, switching when one falters"
              selected={isAutoMode}
              onSelect={() => handleSelect("auto")}
            />
            {PROVIDERS.map((provider) => {
              const circuit = getCircuitState(provider.id);
              return (
                <ProviderOption
                  key={provider.id}
                  label={provider.label}
                  description={provider.description}
                  selected={override === provider.id}
                  live={currentSource === provider.id}
                  status={circuitLabel(circuit.state, circuit.cooldownRemaining)}
                  onSelect={() => handleSelect(provider.id)}
                />
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Provider Trigger (for status bar) ──────────────────────────────────

export type ProviderTriggerProps = {
  source: string | null;
  loading: boolean;
  rateLimited: boolean;
  /** Seconds until the feed is asked again, while it is busy. */
  retryIn?: number;
  /** Aircraft in the feed right now. */
  flightCount: number;
  onClick: () => void;
};

/**
 * "adsb.fi · 203 aircraft", which opens the feed picker. On a phone a
 * healthy feed shows only the count; trouble is always spelled out.
 */
export function ProviderTrigger({
  source,
  loading,
  rateLimited,
  retryIn = 0,
  flightCount,
  onClick,
}: ProviderTriggerProps) {
  const label = rateLimited
    ? retryIn > 0
      ? `Feed busy · retrying in ${retryIn}s`
      : "Feed busy"
    : loading && !source
      ? "Connecting…"
      : source === "none"
        ? "No feed"
        : source
          ? (SOURCE_LABELS[source] ?? source)
          : "Connecting…";
  const healthy = !rateLimited && Boolean(source) && source !== "none" && source !== "opensky";
  const tone = healthy
    ? "text-muted-foreground"
    : source === "none"
      ? "text-danger"
      : rateLimited || source === "opensky"
        ? "text-warning"
        : "text-subtle";
  const count = `${flightCount.toLocaleString()} aircraft`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2.5 transition-colors hover:bg-card"
      aria-label={`${label}, ${count}. Choose the flight feed`}
      aria-haspopup="dialog"
    >
      <span className={`truncate ${tone} ${healthy ? "hidden sm:inline" : ""}`}>
        {label}
      </span>
      <span className="hidden text-subtle sm:inline" aria-hidden="true">
        ·
      </span>
      <span className={`text-muted-foreground ${healthy ? "" : "hidden sm:inline"}`}>
        {count}
      </span>
    </button>
  );
}

function ProviderOption({
  label,
  description,
  selected,
  live = false,
  status = null,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  live?: boolean;
  status?: string | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
        selected ? "bg-card" : "hover:bg-card"
      }`}
    >
      <Circle
        className={`size-2.5 shrink-0 ${selected ? "fill-tint text-tint" : "text-border"}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small text-foreground">
          {label}
          {live && <span className="ml-1.5 text-label text-tint">Live</span>}
        </span>
        {description && (
          <span className="block truncate text-label text-subtle">
            {description}
          </span>
        )}
      </span>
      {status && (
        <span className="shrink-0 font-mono text-micro text-warning">
          {status}
        </span>
      )}
    </button>
  );
}

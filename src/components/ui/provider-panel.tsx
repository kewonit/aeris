"use client";

import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Satellite, X, ChevronUp, Circle } from "lucide-react";
import {
  getCircuitState,
  getProviderOverride,
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
  { id: "adsb", label: "adsb.lol", description: "Primary — server proxy" },
  {
    id: "opensky",
    label: "OpenSky",
    description: "Fallback — limited credits",
  },
  {
    id: "airplanes",
    label: "Airplanes.live",
    description: "Direct — CORS restricted",
  },
];

const SOURCE_LABELS: Record<string, string> = {
  adsb: "adsb.lol",
  opensky: "OpenSky",
  airplanes: "Airplanes.live",
  none: "Unavailable",
};

const SOURCE_COLORS: Record<string, string> = {
  adsb: "rgb(52, 211, 153)", // emerald
  opensky: "rgb(251, 191, 36)", // amber
  airplanes: "rgb(96, 165, 250)", // blue
  none: "rgb(248, 113, 113)", // red
};

function circuitBadge(
  state: CircuitState,
  cooldownMs: number,
): { label: string; color: string } {
  switch (state) {
    case "closed":
      return { label: "OK", color: "rgb(52, 211, 153)" };
    case "open":
      return {
        label: `DOWN ${Math.ceil(cooldownMs / 1000)}s`,
        color: "rgb(248, 113, 113)",
      };
    case "half-open":
      return { label: "PROBING", color: "rgb(251, 191, 36)" };
  }
}

function setProviderOverride(provider: ProviderName | "auto"): void {
  const url = new URL(window.location.href);
  if (provider === "auto") {
    url.searchParams.delete("provider");
  } else {
    url.searchParams.set("provider", provider);
  }
  window.history.replaceState({}, "", url.toString());
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
  const isDev =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

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
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute bottom-full left-0 z-50 mb-2 w-[calc(100vw-2rem)] max-w-70 overflow-hidden rounded-xl border shadow-2xl shadow-background/60 backdrop-blur-2xl sm:w-70 sm:max-w-none"
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
              <Satellite className="h-3 w-3 text-emerald-400/70" />
              <span
                className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: "rgb(var(--ui-fg) / 0.35)" }}
              >
                Providers
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-foreground/5 active:bg-foreground/10"
              aria-label="Close provider selector"
            >
              <X
                className="h-3 w-3"
                style={{ color: "rgb(var(--ui-fg) / 0.3)" }}
              />
            </button>
          </div>

          {/* Provider list */}
          <div className="py-1">
            {/* Auto option */}
            <button
              type="button"
              onClick={() => handleSelect("auto")}
              className={`group flex w-full items-center gap-2.5 px-3.5 py-2 transition-colors ${
                isAutoMode ? "bg-foreground/6" : "hover:bg-foreground/3 active:bg-foreground/6"
              }`}
            >
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                <Circle
                  className="h-2.5 w-2.5"
                  style={{
                    color: isAutoMode
                      ? "rgb(52, 211, 153)"
                      : "rgb(var(--ui-fg) / 0.2)",
                  }}
                  fill={isAutoMode ? "rgb(52, 211, 153)" : "transparent"}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0 text-left">
                <span
                  className="truncate text-[11px] font-medium leading-snug"
                  style={{
                    color: isAutoMode
                      ? "rgb(var(--ui-fg) / 0.85)"
                      : "rgb(var(--ui-fg) / 0.55)",
                  }}
                >
                  Auto
                </span>
                <span
                  className="text-[9px] leading-snug"
                  style={{ color: "rgb(var(--ui-fg) / 0.25)" }}
                >
                  Uses best available
                </span>
              </div>
              <span
                className="shrink-0 rounded px-1.5 py-px text-[8px] font-bold tracking-wider"
                style={{
                  backgroundColor: "rgb(52, 211, 153, 0.07)",
                  color: "rgb(52, 211, 153)",
                }}
              >
                REC
              </span>
            </button>

            {/* Individual providers */}
            {PROVIDERS.map((provider) => {
              const isSelected = override === provider.id;
              const isActive = currentSource === provider.id;
              const circuit = getCircuitState(provider.id);
              const badge = circuitBadge(
                circuit.state,
                circuit.cooldownRemaining,
              );
              const isAvailable = provider.id !== "airplanes" || isDev;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => isAvailable && handleSelect(provider.id)}
                  disabled={!isAvailable}
                  className={`group flex w-full items-center gap-2.5 px-3.5 py-2 transition-colors ${
                    isSelected
                      ? "bg-foreground/6"
                      : isAvailable
                        ? "hover:bg-foreground/3 active:bg-foreground/6"
                        : "cursor-not-allowed opacity-40"
                  }`}
                >
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <Circle
                      className="h-2.5 w-2.5"
                      style={{
                        color: isActive
                          ? (SOURCE_COLORS[provider.id] ??
                            "rgb(var(--ui-fg) / 0.2)")
                          : isSelected
                            ? "rgb(var(--ui-fg) / 0.5)"
                            : "rgb(var(--ui-fg) / 0.2)",
                      }}
                      fill={
                        isActive
                          ? (SOURCE_COLORS[provider.id] ?? "transparent")
                          : "transparent"
                      }
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0 text-left">
                    <span
                      className="truncate text-[11px] font-medium leading-snug"
                      style={{
                        color: isActive
                          ? "rgb(var(--ui-fg) / 0.85)"
                          : "rgb(var(--ui-fg) / 0.55)",
                      }}
                    >
                      {provider.label}
                    </span>
                    <span
                      className="text-[9px] leading-snug"
                      style={{ color: "rgb(var(--ui-fg) / 0.25)" }}
                    >
                      {!isAvailable
                        ? "CORS restricted — dev only"
                        : provider.description}
                    </span>
                  </div>
                  <span
                    className="shrink-0 rounded px-1.5 py-px text-[8px] font-bold tracking-wider"
                    style={{
                      backgroundColor: `${badge.color}12`,
                      color: isAvailable
                        ? badge.color
                        : "rgb(var(--ui-fg) / 0.25)",
                    }}
                  >
                    {isAvailable ? badge.label : "CORS"}
                  </span>
                </button>
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
  onClick: () => void;
};

export function ProviderTrigger({
  source,
  loading,
  rateLimited,
  onClick,
}: ProviderTriggerProps) {
  const label = rateLimited
    ? "Paused"
    : loading && !source
      ? "Connecting…"
      : source
        ? (SOURCE_LABELS[source] ?? source)
        : "Connecting…";

  const dotColor = rateLimited
    ? "text-amber-400/80"
    : source === "none"
      ? "text-red-400/80"
      : source === "opensky"
        ? "text-amber-400/80"
        : source === "airplanes"
          ? "text-blue-400/80"
          : "text-emerald-400/80";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2"
      aria-label="Select ADS-B provider"
    >
      <div className="relative">
        <Satellite className={`h-3 w-3 ${dotColor}`} />
      </div>
      <span
        className="text-[11px] font-medium tracking-wide"
        style={{ color: "rgb(var(--ui-fg) / 0.4)" }}
      >
        {label}
      </span>
      <ChevronUp
        className="h-3 w-3 transition-colors"
        style={{ color: "rgb(var(--ui-fg) / 0.35)" }}
      />
    </button>
  );
}

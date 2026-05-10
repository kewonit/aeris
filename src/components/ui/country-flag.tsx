"use client";

import { useEffect, useSyncExternalStore, memo } from "react";
import { countryNameToIso, looksLikeIsoCode } from "@/lib/country-codes";

// ── External flag store (avoids setState inside effects) ───────────────

class FlagStore {
  private cache = new Map<string, string | null>();
  private listeners = new Set<() => void>();
  private promises = new Map<string, Promise<void>>();

  get(code: string): string | null | undefined {
    return this.cache.get(code.trim().toUpperCase());
  }

  load(code: string): void {
    const upper = code.trim().toUpperCase();
    if (this.cache.has(upper) || this.promises.has(upper)) return;

    if (!/^[A-Z]{2}$/.test(upper)) {
      this.cache.set(upper, null);
      this.emit();
      return;
    }

    const promise = import("country-flag-icons/string/3x2")
      .then((mod) => {
        this.cache.set(upper, (mod as Record<string, string>)[upper] ?? null);
        this.emit();
      })
      .catch(() => {
        this.cache.set(upper, null);
        this.emit();
      })
      .finally(() => {
        this.promises.delete(upper);
      });

    this.promises.set(upper, promise);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const flagStore = new FlagStore();

// ── Hook ───────────────────────────────────────────────────────────────

function useFlagSvg(code: string | null): string | null | undefined {
  // Kick off loading via external store (no setState here)
  useEffect(() => {
    if (code) flagStore.load(code);
  }, [code]);

  return useSyncExternalStore(
    (cb) => flagStore.subscribe(cb),
    () => (code ? flagStore.get(code) : null),
    () => (code ? flagStore.get(code) : null),
  );
}

// ── Types ──────────────────────────────────────────────────────────────

type CountryFlagProps = {
  /** Two-letter ISO country code (preferred). */
  code?: string | null;
  /** Full country name - mapped to ISO via {@link countryNameToIso}. */
  country?: string | null;
  /** Visual size in px or em (default 16). */
  size?: number;
  /** Additional CSS classes for the wrapper. */
  className?: string;
  /** Accessible label override. */
  label?: string;
};

// ── Component ──────────────────────────────────────────────────────────

export const CountryFlag = memo(function CountryFlag({
  code,
  country,
  size = 16,
  className = "",
  label,
}: CountryFlagProps) {
  const resolvedCode =
    (code && looksLikeIsoCode(code) ? code.trim().toUpperCase() : null) ??
    countryNameToIso(country);

  const svg = useFlagSvg(resolvedCode);

  const wrapperStyle: React.CSSProperties = {
    width: Math.round(size * 1.5),
    height: size,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: 2,
    overflow: "hidden",
  };

  if (!resolvedCode) {
    return (
      <span
        className={`inline-block bg-foreground/5 rounded ${className}`}
        style={wrapperStyle}
        aria-hidden="true"
      />
    );
  }

  if (svg === undefined) {
    return (
      <span
        className={`inline-block bg-foreground/5 animate-pulse rounded ${className}`}
        style={wrapperStyle}
        aria-hidden="true"
      />
    );
  }

  if (!svg) {
    // Fallback: show ISO code in a styled badge
    return (
      <span
        className={`inline-flex items-center justify-center bg-foreground/8 rounded text-[9px] font-bold tracking-wider text-foreground/40 uppercase ${className}`}
        style={wrapperStyle}
        aria-label={label ?? `Country: ${resolvedCode}`}
        title={label ?? resolvedCode}
      >
        {resolvedCode}
      </span>
    );
  }

  return (
    <span
      className={`inline-block ${className}`}
      style={wrapperStyle}
      aria-label={label ?? `Flag of ${resolvedCode}`}
      title={label ?? resolvedCode}
      dangerouslySetInnerHTML={{
        __html: svg.replace(
          "<svg",
          `<svg style="width:100%;height:100%;display:block;"`,
        ),
      }}
    />
  );
});

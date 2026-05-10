"use client";

import { useState, useCallback, memo, useMemo } from "react";
import { Plane } from "lucide-react";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import {
  wasAirlineLogoRecentlyFailed,
  trackAirlineLogoLoaded,
  markAirlineLogoFailed,
} from "@/lib/logo-cache";

// ── Types ──────────────────────────────────────────────────────────────

type AirlineLogoProps = {
  /** Raw callsign, e.g. "UAL123" */
  callsign?: string | null;
  /** Resolved airline name (optional fallback). */
  airlineName?: string | null;
  /** Size in px (default 20). */
  size?: number;
  /** Additional CSS classes for the wrapper. */
  className?: string;
  /** Use eager loading (default true). Recommended for visible lists. */
  eager?: boolean;
};

// ── Inner component (keyed by identity so React remounts on change) ────

function AirlineLogoInner({
  callsign,
  airlineName,
  size = 20,
  className = "",
  eager = true,
}: AirlineLogoProps) {
  const candidates = useMemo(() => {
    const all = airlineLogoCandidates(airlineName ?? null, callsign ?? null);
    // Skip URLs known to have failed recently so we don't hammer the
    // network with repeated 404s across the app.
    return all.filter((url) => !wasAirlineLogoRecentlyFailed(url));
  }, [airlineName, callsign]);

  const [attemptIndex, setAttemptIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const currentSrc = candidates[attemptIndex];

  const handleLoad = useCallback(() => {
    if (currentSrc) trackAirlineLogoLoaded(currentSrc);
    setLoaded(true);
  }, [currentSrc]);

  const handleError = useCallback(() => {
    if (currentSrc) markAirlineLogoFailed(currentSrc);
    setLoaded(false);
    const next = attemptIndex + 1;
    if (next < candidates.length) {
      setAttemptIndex(next);
    } else {
      setFailed(true);
    }
  }, [currentSrc, candidates.length, attemptIndex]);

  if (!currentSrc || failed) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md bg-foreground/5 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <Plane
          className="text-foreground/25"
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      </span>
    );
  }

  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-md bg-white/5 overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {!loaded && (
        <span
          className="absolute inset-0 animate-pulse bg-foreground/8"
          aria-hidden="true"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={currentSrc} // fresh DOM node for each candidate
        src={currentSrc}
        alt={airlineName ? `${airlineName} logo` : "Airline logo"}
        width={size}
        height={size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`relative object-contain transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        style={{ width: size, height: size }}
        onLoad={handleLoad}
        onError={handleError}
      />
    </span>
  );
}

// ── Public wrapper (forces remount when identity changes) ──────────────

export const AirlineLogo = memo(function AirlineLogo(props: AirlineLogoProps) {
  const identityKey = useMemo(
    () => `${props.callsign ?? ""}|${props.airlineName ?? ""}`,
    [props.callsign, props.airlineName],
  );
  return <AirlineLogoInner key={identityKey} {...props} />;
});

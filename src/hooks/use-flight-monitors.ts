"use client";

import { useEffect, useRef, useState } from "react";
import type { FlightState } from "@/lib/opensky";
import { fetchFlightByHex } from "@/lib/flight-api";
import {
  GITHUB_REPO_API,
  type SelectionLink,
} from "@/components/flight-tracker-utils";

/** Below about 30 kt a landed aircraft is taxiing, and FPV ends. */
const FPV_TAXI_SPEED_MPS = 15;
/** FPV ends this long after touchdown even if the aircraft is still rolling. */
const FPV_MAX_ROLLOUT_MS = 45_000;

// ── Types ──────────────────────────────────────────────────────────────

/** A shared link to an aircraft, waiting for the aircraft to be found. */
export type PendingAircraftLink = Extract<SelectionLink, { icao24: string }>;

export interface UseFlightMonitorsOptions {
  pendingLinkRef: React.MutableRefObject<PendingAircraftLink | null>;
  fpvIcao24: string | null;
  fpvFlight: FlightState | null;
  followIcao24: string | null;
  followFlight: FlightState | null;
  selectedIcao24: string | null;
  selectedFlight: FlightState | null;
  displayFlights: FlightState[];
  rateLimited: boolean;
  /**
   * The linked aircraft was found. `remote` is true when it came from a
   * worldwide lookup, so the map may need to move to it first.
   */
  onLinkResolved: (
    link: PendingAircraftLink,
    flight: FlightState,
    remote: boolean,
  ) => void;
  /** The followed aircraft has left the feed. */
  onFollowLost: () => void;
  /** The selected aircraft has been missing from the feed for a minute. */
  onSelectionLost: () => void;
  /** Ends FPV: after a landing, or when the feed has lost the aircraft. */
  endFpv: (how: "landed" | "lost") => void;
}

export interface UseFlightMonitorsResult {
  repoStars: number | null;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useFlightMonitors(
  opts: UseFlightMonitorsOptions,
): UseFlightMonitorsResult {
  const {
    pendingLinkRef,
    fpvIcao24,
    fpvFlight,
    followIcao24,
    followFlight,
    selectedIcao24,
    selectedFlight,
    displayFlights,
    rateLimited,
    onLinkResolved,
    onFollowLost,
    onSelectionLost,
    endFpv,
  } = opts;

  const [repoStars, setRepoStars] = useState<number | null>(null);

  // ── Pending link resolution ──────────────────────────────────────

  const linkLookupDoneRef = useRef(false);
  useEffect(() => {
    const pending = pendingLinkRef.current;
    if (!pending || fpvIcao24) return;

    const match = displayFlights.find(
      (f) => f.icao24.toLowerCase() === pending.icao24,
    );
    if (match && match.longitude != null && match.latitude != null) {
      pendingLinkRef.current = null;
      linkLookupDoneRef.current = false;
      onLinkResolved(pending, match, false);
      return;
    }

    if (!linkLookupDoneRef.current && displayFlights.length > 0) {
      linkLookupDoneRef.current = true;
      const controller = new AbortController();
      fetchFlightByHex(pending.icao24, controller.signal)
        .then((result) => {
          if (pendingLinkRef.current !== pending) return;
          pendingLinkRef.current = null;
          if (
            result.flight &&
            result.flight.longitude != null &&
            result.flight.latitude != null
          ) {
            onLinkResolved(pending, result.flight, true);
          }
        })
        .catch(() => {
          // Flight lookup failed (network error, timeout, or abort) - reset pending state
          if (pendingLinkRef.current === pending) {
            pendingLinkRef.current = null;
          }
        });
      return () => controller.abort();
    }
  }, [displayFlights, fpvIcao24, pendingLinkRef, onLinkResolved]);

  // ── FPV landing and miss counting ────────────────────────────────

  const fpvMissCountRef = useRef(0);
  const fpvActivatedAtRef = useRef(0);
  // When the FPV aircraft was first reported on the ground.
  const fpvGroundSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!fpvIcao24) {
      fpvMissCountRef.current = 0;
      fpvActivatedAtRef.current = 0;
      fpvGroundSinceRef.current = null;
      return;
    }

    if (fpvActivatedAtRef.current === 0) {
      fpvActivatedAtRef.current = Date.now();
    }

    let ended: "landed" | "lost" | null = null;
    if (fpvFlight) {
      fpvMissCountRef.current = 0;
      if (fpvFlight.onGround) {
        // The landing roll plays out; FPV ends once the aircraft is down to
        // taxiing speed, or has been on the ground a while.
        const now = Date.now();
        fpvGroundSinceRef.current ??= now;
        const slowed = (fpvFlight.velocity ?? 0) < FPV_TAXI_SPEED_MPS;
        if (slowed || now - fpvGroundSinceRef.current > FPV_MAX_ROLLOUT_MS) {
          ended = "landed";
        }
      } else {
        fpvGroundSinceRef.current = null;
      }
    } else {
      // Grace period: don't count misses for the first 30s after FPV
      // activation. This allows time for city changes and initial polls
      // to complete when entering FPV from a deep-link.
      const elapsed = Date.now() - fpvActivatedAtRef.current;
      if (!rateLimited && elapsed > 30_000) {
        fpvMissCountRef.current += 1;
      }
      if (fpvMissCountRef.current >= 3) ended = "lost";
    }
    if (!ended) return;
    const how = ended;
    const timer = setTimeout(() => endFpv(how), 0);
    return () => clearTimeout(timer);
  }, [fpvIcao24, fpvFlight, rateLimited, displayFlights, endFpv]);

  // ── Follow miss counting ─────────────────────────────────────────

  const followMissCountRef = useRef(0);
  const followActivatedAtRef = useRef(0);
  useEffect(() => {
    if (!followIcao24) {
      followMissCountRef.current = 0;
      followActivatedAtRef.current = 0;
      return;
    }

    if (followActivatedAtRef.current === 0) {
      followActivatedAtRef.current = Date.now();
    }

    if (followFlight) {
      followMissCountRef.current = 0;
    } else {
      // Grace period: don't count misses for the first 15s after follow
      // activation or during rate limiting. Prevents auto-deselection
      // during city transitions or transient API failures.
      const elapsed = Date.now() - followActivatedAtRef.current;
      if (!rateLimited && elapsed > 15_000) {
        followMissCountRef.current += 1;
      }
      if (followMissCountRef.current >= 3) {
        const timer = setTimeout(onFollowLost, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [
    followIcao24,
    followFlight,
    rateLimited,
    displayFlights,
    onFollowLost,
  ]);

  // ── Selected flight missing timeout ──────────────────────────────

  const missingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedIcao24) {
      missingSinceRef.current = null;
      return;
    }
    if (selectedFlight) {
      missingSinceRef.current = null;
      return;
    }
    const now = Date.now();
    if (missingSinceRef.current == null) {
      missingSinceRef.current = now;
      return;
    }
    if (now - missingSinceRef.current >= 60_000) {
      const timer = setTimeout(onSelectionLost, 0);
      missingSinceRef.current = null;
      return () => clearTimeout(timer);
    }
  }, [selectedIcao24, selectedFlight, displayFlights, onSelectionLost]);

  // ── Repo stars ───────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    async function loadRepoStars() {
      try {
        const res = await fetch(GITHUB_REPO_API);
        if (!res.ok) return;
        const data = (await res.json()) as { stargazers_count?: number };
        if (mounted && typeof data.stargazers_count === "number") {
          setRepoStars(data.stargazers_count);
        }
      } catch {
        // GitHub API failures are non-critical - star count is cosmetic
      }
    }

    loadRepoStars();
    return () => {
      mounted = false;
    };
  }, []);

  return { repoStars };
}

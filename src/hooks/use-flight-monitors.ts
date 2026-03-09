"use client";

import { useEffect, useRef, useState } from "react";
import { fetchFlightByIcao24, type FlightState } from "@/lib/opensky";
import { cityFromFlight } from "@/components/flight-tracker-random";
import {
  syncFpvToUrl,
  GITHUB_REPO_API,
} from "@/components/flight-tracker-utils";
import type { City } from "@/lib/cities";

// ── Types ──────────────────────────────────────────────────────────────

export interface UseFlightMonitorsOptions {
  pendingFpvRef: React.RefObject<string | null>;
  fpvIcao24: string | null;
  fpvFlight: FlightState | null;
  followIcao24: string | null;
  followFlight: FlightState | null;
  selectedIcao24: string | null;
  selectedFlight: FlightState | null;
  displayFlights: FlightState[];
  activeCity: City;
  rateLimited: boolean;
  setSelectedIcao24: (v: string | null) => void;
  setFpvIcao24: (v: string | null) => void;
  setFollowIcao24: (v: string | null) => void;
  setCityOverride: (v: City) => void;
  setFpvSeedCenter: (v: { lng: number; lat: number } | null) => void;
}

export interface UseFlightMonitorsResult {
  repoStars: number | null;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useFlightMonitors(
  opts: UseFlightMonitorsOptions,
): UseFlightMonitorsResult {
  const {
    pendingFpvRef,
    fpvIcao24,
    fpvFlight,
    followIcao24,
    followFlight,
    selectedIcao24,
    selectedFlight,
    displayFlights,
    activeCity,
    rateLimited,
    setSelectedIcao24,
    setFpvIcao24,
    setFollowIcao24,
    setCityOverride,
    setFpvSeedCenter,
  } = opts;

  const [repoStars, setRepoStars] = useState<number | null>(null);

  // ── Pending FPV resolution ───────────────────────────────────────

  const fpvLookupDoneRef = useRef(false);
  useEffect(() => {
    const pending = pendingFpvRef.current;
    if (!pending || fpvIcao24) return;

    const match = displayFlights.find(
      (f) => f.icao24.toLowerCase() === pending,
    );
    if (match && match.longitude != null && match.latitude != null) {
      if (match.onGround) {
        (pendingFpvRef as React.MutableRefObject<string | null>).current = null;
        syncFpvToUrl(null, activeCity);
        setSelectedIcao24(match.icao24);
        return;
      }
      (pendingFpvRef as React.MutableRefObject<string | null>).current = null;
      fpvLookupDoneRef.current = false;
      setFpvSeedCenter({ lng: match.longitude, lat: match.latitude });
      setFpvIcao24(pending);
      setFollowIcao24(null);
      return;
    }

    if (!fpvLookupDoneRef.current && displayFlights.length > 0) {
      fpvLookupDoneRef.current = true;
      const controller = new AbortController();
      fetchFlightByIcao24(pending, controller.signal)
        .then((result) => {
          if (
            result.flight &&
            result.flight.longitude != null &&
            result.flight.latitude != null &&
            !result.flight.onGround &&
            pendingFpvRef.current === pending
          ) {
            const focusCity = cityFromFlight(result.flight);
            if (focusCity) {
              setCityOverride(focusCity);
            }
            setFpvSeedCenter({
              lng: result.flight.longitude,
              lat: result.flight.latitude,
            });
            (pendingFpvRef as React.MutableRefObject<string | null>).current =
              null;
            setFpvIcao24(pending);
            setFollowIcao24(null);
          } else if (pendingFpvRef.current === pending) {
            (pendingFpvRef as React.MutableRefObject<string | null>).current =
              null;
            syncFpvToUrl(null, activeCity);
            if (result.flight) {
              setSelectedIcao24(result.flight.icao24);
            }
          }
        })
        .catch(() => {
          if (pendingFpvRef.current === pending) {
            (pendingFpvRef as React.MutableRefObject<string | null>).current =
              null;
          }
        });
      return () => controller.abort();
    }
  }, [
    displayFlights,
    fpvIcao24,
    activeCity,
    pendingFpvRef,
    setSelectedIcao24,
    setFpvIcao24,
    setFollowIcao24,
    setCityOverride,
    setFpvSeedCenter,
  ]);

  // ── FPV miss counting ────────────────────────────────────────────

  const fpvMissCountRef = useRef(0);
  useEffect(() => {
    if (!fpvIcao24) {
      fpvMissCountRef.current = 0;
      return;
    }

    if (fpvFlight) {
      fpvMissCountRef.current = 0;
      if (fpvFlight.onGround) {
        const exitIcao = fpvIcao24;
        const timer = setTimeout(() => {
          setSelectedIcao24(exitIcao);
          setFpvIcao24(null);
        }, 0);
        return () => clearTimeout(timer);
      }
    } else {
      if (!rateLimited) {
        fpvMissCountRef.current += 1;
      }
      if (fpvMissCountRef.current >= 3) {
        const exitIcao = fpvIcao24;
        const timer = setTimeout(() => {
          setSelectedIcao24(exitIcao);
          setFpvIcao24(null);
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [
    fpvIcao24,
    fpvFlight,
    rateLimited,
    displayFlights,
    setSelectedIcao24,
    setFpvIcao24,
  ]);

  // ── Follow miss counting ─────────────────────────────────────────

  const followMissCountRef = useRef(0);
  useEffect(() => {
    if (!followIcao24) {
      followMissCountRef.current = 0;
      return;
    }
    if (followFlight) {
      followMissCountRef.current = 0;
    } else {
      followMissCountRef.current += 1;
      if (followMissCountRef.current >= 3) {
        const timer = setTimeout(() => setFollowIcao24(null), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [followIcao24, followFlight, displayFlights, setFollowIcao24]);

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
      const timer = setTimeout(() => setSelectedIcao24(null), 0);
      missingSinceRef.current = null;
      return () => clearTimeout(timer);
    }
  }, [selectedIcao24, selectedFlight, displayFlights, setSelectedIcao24]);

  // ── Repo stars ───────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    async function loadRepoStars() {
      try {
        const res = await fetch(GITHUB_REPO_API, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { stargazers_count?: number };
        if (mounted && typeof data.stargazers_count === "number") {
          setRepoStars(data.stargazers_count);
        }
      } catch {
        /* silent fallback */
      }
    }

    loadRepoStars();
    return () => {
      mounted = false;
    };
  }, []);

  return { repoStars };
}

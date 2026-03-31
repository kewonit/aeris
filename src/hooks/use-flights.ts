"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { FlightState } from "@/lib/opensky";
import { fetchFlightsByPoint } from "@/lib/flight-api";
import type { City } from "@/lib/cities";

/** Normal polling interval — readsb allows 1 req/s; 5s gives 2× data density at 0.2 req/s. */
const POLL_INTERVAL_MS = 5_000;

/** Backoff on rate limit (429) or repeated errors. */
const RATE_LIMIT_BACKOFF_MS = 15_000;

/** If tab was hidden longer than this, fetch immediately on resume. */
const VISIBILITY_RESUME_STALE_MS = 15_000;

/** Radius (degrees) for FPV point queries — ~120 nautical miles. */
const FPV_POINT_RADIUS = 2;

/**
 * Number of consecutive empty API responses before we accept that the area
 * genuinely has zero flights. Protects against transient API failures that
 * return valid JSON with an empty aircraft list — without this guard,
 * a single empty response would wipe all flights and trigger mass-teleport
 * artifacts when data returns on the next poll.
 */
const MAX_EMPTY_STREAK = 3;

/**
 * Fetches flights via readsb (Airplanes.live → adsb.lol fallback).
 * In FPV mode the query center moves with the tracked aircraft.
 * City changes are ignored while in FPV.
 */
export function useFlights(
  city: City | null,
  fpvIcao24: string | null = null,
  fpvSeedCenter: { lng: number; lat: number } | null = null,
) {
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [source, setSource] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lastFetchRef = useRef(0);
  const emptyStreakRef = useRef(0);
  const fpvCenterRef = useRef<{ lng: number; lat: number } | null>(null);
  const fpvSeedCenterRef = useRef<{ lng: number; lat: number } | null>(
    fpvSeedCenter,
  );
  const fpvIcao24Ref = useRef<string | null>(fpvIcao24);
  const fpvSeedRef = useRef<string | null>(null);
  const fetchDataRef = useRef<(target: City) => void>(() => {});
  fpvIcao24Ref.current = fpvIcao24;
  fpvSeedCenterRef.current = fpvSeedCenter;

  useEffect(() => {
    if (!fpvIcao24) {
      fpvCenterRef.current = null;
      fpvSeedRef.current = null;
      return;
    }
    if (fpvSeedRef.current === fpvIcao24) return;

    const match = flights.find((f) => f.icao24.toLowerCase() === fpvIcao24);
    if (match?.longitude != null && match?.latitude != null) {
      fpvCenterRef.current = { lng: match.longitude, lat: match.latitude };
    }
    fpvSeedRef.current = fpvIcao24;
  }, [fpvIcao24, flights]);

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setRetryIn(0);
  }, []);

  const startCountdown = useCallback(
    (ms: number) => {
      clearCountdown();
      const endTime = Date.now() + ms;
      setRetryIn(Math.ceil(ms / 1000));
      countdownRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        setRetryIn(remaining);
        if (remaining <= 0) clearCountdown();
      }, 1000);
    },
    [clearCountdown],
  );

  const clearSchedule = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(
    (target: City, delayMs: number) => {
      clearSchedule();
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      timerRef.current = setTimeout(() => {
        fetchDataRef.current(target);
      }, delayMs);
    },
    [clearSchedule],
  );

  const fetchData = useCallback(
    async (target: City) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setLoading(true);
        setError(null);

        const inFpv = fpvIcao24Ref.current !== null;
        let lat: number;
        let lon: number;
        let radiusDeg: number;

        if (inFpv && fpvCenterRef.current) {
          lat = fpvCenterRef.current.lat;
          lon = fpvCenterRef.current.lng;
          radiusDeg = FPV_POINT_RADIUS;
        } else if (inFpv && fpvSeedCenterRef.current) {
          fpvCenterRef.current = fpvSeedCenterRef.current;
          lat = fpvSeedCenterRef.current.lat;
          lon = fpvSeedCenterRef.current.lng;
          radiusDeg = FPV_POINT_RADIUS;
        } else if (inFpv) {
          fpvCenterRef.current = {
            lng: target.coordinates[0],
            lat: target.coordinates[1],
          };
          lat = target.coordinates[1];
          lon = target.coordinates[0];
          radiusDeg = FPV_POINT_RADIUS;
        } else {
          lat = target.coordinates[1];
          lon = target.coordinates[0];
          radiusDeg = target.radius;
        }

        const result = await fetchFlightsByPoint(
          lat,
          lon,
          radiusDeg,
          controller.signal,
        );

        setSource(result.source ?? null);

        if (result.rateLimited) {
          setRateLimited(true);
          startCountdown(RATE_LIMIT_BACKOFF_MS);
          scheduleNext(target, RATE_LIMIT_BACKOFF_MS);
          return;
        }

        setRateLimited(false);
        clearCountdown();

        // All circuits open — preserve last-known flights
        if (result.source === "none" && result.flights.length === 0) {
          scheduleNext(target, POLL_INTERVAL_MS);
          return;
        }

        // ── Guard against transient empty API responses ─────────────
        // If we previously had flights but this response is empty, it's
        // likely a transient API failure. Keep last-known state to avoid
        // mass-teleport artifacts when real data returns next poll.
        if (result.flights.length === 0) {
          emptyStreakRef.current += 1;
          // After MAX_EMPTY_STREAK consecutive empties, accept it as
          // genuinely empty (e.g. user panned to an empty ocean area).
          if (emptyStreakRef.current < MAX_EMPTY_STREAK) {
            // Preserve existing flights — schedule next poll normally.
            lastFetchRef.current = Date.now();
            scheduleNext(target, POLL_INTERVAL_MS);
            return;
          }
        } else {
          emptyStreakRef.current = 0;
        }

        setFlights(result.flights);
        lastFetchRef.current = Date.now();

        // Update FPV center to follow tracked aircraft
        if (inFpv && fpvIcao24Ref.current) {
          const tracked = result.flights.find(
            (f) => f.icao24.toLowerCase() === fpvIcao24Ref.current,
          );
          if (tracked?.longitude != null && tracked?.latitude != null) {
            fpvCenterRef.current = {
              lng: tracked.longitude,
              lat: tracked.latitude,
            };
          }
        }

        scheduleNext(target, POLL_INTERVAL_MS);
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (isAbort) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        scheduleNext(target, RATE_LIMIT_BACKOFF_MS);
      } finally {
        setLoading(false);
      }
    },
    [scheduleNext, startCountdown, clearCountdown],
  );

  useEffect(() => {
    fetchDataRef.current = (target: City) => {
      void fetchData(target);
    };
  }, [fetchData]);

  useEffect(() => {
    if (!city) return;

    const activeCity = city;

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") {
        clearSchedule();
        abortRef.current?.abort();
        return;
      }

      const elapsed = Date.now() - lastFetchRef.current;

      if (elapsed >= VISIBILITY_RESUME_STALE_MS) {
        clearSchedule();
        fetchData(activeCity);
      } else {
        const remaining = Math.max(1_000, POLL_INTERVAL_MS - elapsed);
        clearSchedule();
        scheduleNext(activeCity, remaining);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [city, fetchData, scheduleNext, clearSchedule]);

  useEffect(() => {
    if (fpvIcao24Ref.current !== null) {
      // In FPV mode, the FPV effect handles fetching. Clear any stale
      // old-city timer that might still be pending to prevent concurrent
      // fetches from different regions.
      clearSchedule();
      return;
    }

    clearSchedule();

    if (!city) {
      setFlights([]);
      setRateLimited(false);
      clearCountdown();
      return;
    }

    setRateLimited(false);
    clearCountdown();

    const deferred = setTimeout(() => fetchData(city), 0);

    return () => {
      clearTimeout(deferred);
      clearSchedule();
      abortRef.current?.abort();
      abortRef.current = null;
      clearCountdown();
    };
  }, [city, fetchData, clearCountdown, clearSchedule]);

  const prevFpvRef = useRef<string | null>(fpvIcao24);
  useEffect(() => {
    const wasInFpv = prevFpvRef.current !== null;
    const isInFpv = fpvIcao24 !== null;
    prevFpvRef.current = fpvIcao24;

    if (!wasInFpv && isInFpv) {
      clearSchedule();
      if (city) fetchData(city);
    } else if (wasInFpv && !isInFpv && city) {
      fpvCenterRef.current = null;
      clearSchedule();
      fetchData(city);
    }
  }, [fpvIcao24, city, clearSchedule, fetchData]);

  // Trigger immediate fetch on network reconnect
  useEffect(() => {
    if (typeof window === "undefined" || !city) return;
    const activeCity = city;
    const onOnline = () => {
      clearSchedule();
      fetchData(activeCity);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [city, fetchData, clearSchedule]);

  useEffect(() => {
    return () => {
      clearSchedule();
      abortRef.current?.abort();
      clearCountdown();
    };
  }, [clearSchedule, clearCountdown]);

  return {
    flights,
    loading,
    error,
    rateLimited,
    retryIn,
    source,
  };
}

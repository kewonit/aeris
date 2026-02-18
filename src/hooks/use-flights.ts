"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchFlightsByBbox,
  bboxFromCenter,
  type FlightState,
} from "@/lib/opensky";
import type { City } from "@/lib/cities";

const BASE_POLL_MS = 30_000;
const CONSERVATIVE_POLL_MS = 60_000;
const CAUTIOUS_POLL_MS = 120_000;
const EMERGENCY_POLL_MS = 300_000;

const CREDIT_TIER_CONSERVATIVE = 2_000;
const CREDIT_TIER_CAUTIOUS = 800;
const CREDIT_TIER_EMERGENCY = 200;

const RATE_LIMIT_BACKOFF_MS = 30_000;
const VISIBILITY_RESUME_STALE_MS = 60_000;
const FPV_BBOX_RADIUS = 2;

function adaptiveInterval(creditsRemaining: number | null): number {
  if (creditsRemaining === null) return BASE_POLL_MS;
  if (creditsRemaining < CREDIT_TIER_EMERGENCY) return EMERGENCY_POLL_MS;
  if (creditsRemaining < CREDIT_TIER_CAUTIOUS) return CAUTIOUS_POLL_MS;
  if (creditsRemaining < CREDIT_TIER_CONSERVATIVE) return CONSERVATIVE_POLL_MS;
  return BASE_POLL_MS;
}

/**
 * @param city        – The active city (always needed for fallback bbox).
 * @param fpvIcao24   – When non-null the hook switches to a small moving bbox
 *                      centred on this aircraft, saving API credits.
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
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const creditsRef = useRef<number | null>(null);
  const lastFetchRef = useRef(0);
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

    const match = flights.find(
      (f) => f.icao24.toLowerCase() === fpvIcao24,
    );
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
        let bbox: [number, number, number, number];
        const inFpv = fpvIcao24Ref.current !== null;

        if (inFpv && fpvCenterRef.current) {
          bbox = bboxFromCenter(
            fpvCenterRef.current.lng,
            fpvCenterRef.current.lat,
            FPV_BBOX_RADIUS,
          );
        } else if (inFpv && fpvSeedCenterRef.current) {
          fpvCenterRef.current = fpvSeedCenterRef.current;
          bbox = bboxFromCenter(
            fpvSeedCenterRef.current.lng,
            fpvSeedCenterRef.current.lat,
            FPV_BBOX_RADIUS,
          );
        } else {
          bbox = bboxFromCenter(
            target.coordinates[0],
            target.coordinates[1],
            target.radius,
          );
        }

        const result = await fetchFlightsByBbox(...bbox, controller.signal);

        if (result.rateLimited) {
          const retryDelayMs =
            result.retryAfterSeconds && result.retryAfterSeconds > 0
              ? result.retryAfterSeconds * 1000
              : RATE_LIMIT_BACKOFF_MS;
          setRateLimited(true);
          startCountdown(retryDelayMs);
          scheduleNext(target, retryDelayMs);
          return;
        }

        setRateLimited(false);
        clearCountdown();
        setFlights(result.flights);
        lastFetchRef.current = Date.now();
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

        if (result.creditsRemaining !== null) {
          creditsRef.current = result.creditsRemaining;
          setCreditsRemaining(result.creditsRemaining);
        }

        const nextInterval = adaptiveInterval(creditsRef.current);
        scheduleNext(target, nextInterval);
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
      if (document.visibilityState !== "visible") return;

      const elapsed = Date.now() - lastFetchRef.current;

      if (elapsed >= VISIBILITY_RESUME_STALE_MS) {
        clearSchedule();
        fetchData(activeCity);
      } else {
        const interval = adaptiveInterval(creditsRef.current);
        const remaining = Math.max(1_000, interval - elapsed);
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
      clearCountdown();
    };
  }, [city, fetchData, clearCountdown, clearSchedule]);

  const prevFpvRef = useRef<string | null>(fpvIcao24);
  useEffect(() => {
    const wasInFpv = prevFpvRef.current !== null;
    const isInFpv = fpvIcao24 !== null;
    prevFpvRef.current = fpvIcao24;

    if (wasInFpv && !isInFpv && city) {
      fpvCenterRef.current = null;
      clearSchedule();
      fetchData(city);
    }
  }, [fpvIcao24, city, clearSchedule, fetchData]);

  return { flights, loading, error, rateLimited, retryIn, creditsRemaining };
}

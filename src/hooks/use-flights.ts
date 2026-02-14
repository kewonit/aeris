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

function adaptiveInterval(creditsRemaining: number | null): number {
  if (creditsRemaining === null) return BASE_POLL_MS;
  if (creditsRemaining < CREDIT_TIER_EMERGENCY) return EMERGENCY_POLL_MS;
  if (creditsRemaining < CREDIT_TIER_CAUTIOUS) return CAUTIOUS_POLL_MS;
  if (creditsRemaining < CREDIT_TIER_CONSERVATIVE) return CONSERVATIVE_POLL_MS;
  return BASE_POLL_MS;
}

export function useFlights(city: City | null) {
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
      timerRef.current = setTimeout(() => fetchData(target), delayMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fetchData = useCallback(
    async (target: City) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setLoading(true);
        setError(null);

        const bbox = bboxFromCenter(
          target.coordinates[0],
          target.coordinates[1],
          target.radius,
        );
        const result = await fetchFlightsByBbox(...bbox, controller.signal);

        if (result.rateLimited) {
          setRateLimited(true);
          startCountdown(RATE_LIMIT_BACKOFF_MS);
          scheduleNext(target, RATE_LIMIT_BACKOFF_MS);
          return;
        }

        setRateLimited(false);
        clearCountdown();
        setFlights(result.flights);
        lastFetchRef.current = Date.now();

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
        setFlights([]);
        scheduleNext(target, RATE_LIMIT_BACKOFF_MS);
      } finally {
        setLoading(false);
      }
    },
    [scheduleNext, startCountdown, clearCountdown],
  );

  useEffect(() => {
    if (!city) return;

    const activeCity = city;

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
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
      } else {
        clearSchedule();
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

  return { flights, loading, error, rateLimited, retryIn, creditsRemaining };
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchFlightsByBbox,
  bboxFromCenter,
  type FlightState,
} from "@/lib/opensky";
import type { City } from "@/lib/cities";

const POLL_INTERVAL_MS = 15_000;
const RATE_LIMIT_BACKOFF_MS = 30_000;

export function useFlights(city: City | null) {
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const scheduleNext = useCallback(
    (target: City, delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
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
        scheduleNext(target, POLL_INTERVAL_MS);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
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
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!city) {
      setFlights([]);
      setRateLimited(false);
      clearCountdown();
      return;
    }

    setRateLimited(false);
    clearCountdown();
    fetchData(city);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      clearCountdown();
    };
  }, [city, fetchData, clearCountdown]);

  return { flights, loading, error, rateLimited, retryIn };
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { FlightTrack } from "@/lib/opensky";

type TrackCacheEntry = {
  fetchedAt: number;
  track: FlightTrack | null;
};

const TRACK_CACHE_TTL_MS = 10 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 60_000;
const TRACK_CACHE_MAX_ENTRIES = 100;
const SELECTION_DEBOUNCE_MS = 350;
const FETCH_TIMEOUT_MS = 15_000;
const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;
const DEFAULT_RETRY_MS = 5_000;

const trackCache = new Map<string, TrackCacheEntry>();
let rateLimitedUntil = 0;

function cacheTtlMs(track: FlightTrack | null): number {
  return track ? TRACK_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
}

function parseRetryAfter(res: Response): number {
  const header = res.headers.get("Retry-After");
  if (!header) return DEFAULT_RETRY_MS;
  const sec = Number.parseFloat(header);
  if (!Number.isFinite(sec) || sec <= 0) return DEFAULT_RETRY_MS;
  const ms = sec * 1000;
  return Math.max(MIN_RETRY_MS, Math.min(MAX_RETRY_MS, ms));
}

async function fetchTrace(
  hex: string,
  signal: AbortSignal,
): Promise<{
  track: FlightTrack | null;
  rateLimited: boolean;
  retryAfterMs: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
  }

  try {
    const res = await fetch(
      `/api/flights/trace?hex=${encodeURIComponent(hex)}`,
      { signal: controller.signal, cache: "no-store" },
    );

    if (res.status === 429) {
      return {
        track: null,
        rateLimited: true,
        retryAfterMs: parseRetryAfter(res),
      };
    }

    if (!res.ok) {
      return { track: null, rateLimited: false, retryAfterMs: 0 };
    }

    const data = (await res.json()) as { track: FlightTrack | null };
    return { track: data.track ?? null, rateLimited: false, retryAfterMs: 0 };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

export function useFlightTrack(
  icao24: string | null,
  options?: {
    refreshMs?: number;
    enabled?: boolean;
  },
): {
  track: FlightTrack | null;
  loading: boolean;
  fetchedAtMs: number;
  rateLimited: boolean;
} {
  const refreshMs = options?.refreshMs ?? 0;
  const enabled = options?.enabled ?? true;

  const [track, setTrack] = useState<FlightTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAtMs, setFetchedAtMs] = useState(0);
  const [rateLimited, setRateLimited] = useState(false);

  const requestIdRef = useRef(0);
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!icao24) {
      setTrack(null);
      setLoading(false);
      setFetchedAtMs(0);
      activeKeyRef.current = null;
      return;
    }

    const key = icao24.trim().toLowerCase();
    const isKeyChange = activeKeyRef.current !== key;
    activeKeyRef.current = key;

    const cached = trackCache.get(key);
    const hasCachedTrack = cached?.track != null;

    if (cached && hasCachedTrack) {
      setTrack(cached.track);
      setFetchedAtMs(cached.fetchedAt);
    } else if (isKeyChange) {
      setTrack(null);
      setFetchedAtMs(0);
    }

    if (!enabled) {
      setLoading(false);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    let retryTimer: number | null = null;

    async function load() {
      const now = Date.now();

      for (const [k, entry] of trackCache) {
        if (now - entry.fetchedAt > cacheTtlMs(entry.track)) {
          trackCache.delete(k);
        }
      }

      if (now < rateLimitedUntil) return;

      const existing = trackCache.get(key);
      if (existing && now - existing.fetchedAt <= cacheTtlMs(existing.track)) {
        return;
      }

      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const result = await fetchTrace(key, controller.signal);
        if (!alive || requestId !== requestIdRef.current) return;

        const fetchedAt = Date.now();

        if (result.rateLimited) {
          rateLimitedUntil = fetchedAt + result.retryAfterMs;
          setRateLimited(true);
          // Schedule a one-shot retry after the cooldown so we recover
          // automatically even without a refreshMs interval.
          retryTimer = window.setTimeout(() => {
            if (!alive) return;
            setRateLimited(false);
            void load();
          }, result.retryAfterMs);
          return;
        }

        setRateLimited(false);

        const nextTrack = result.track;

        trackCache.delete(key);
        trackCache.set(key, { fetchedAt, track: nextTrack });

        while (trackCache.size > TRACK_CACHE_MAX_ENTRIES) {
          const oldestKey = trackCache.keys().next().value as
            | string
            | undefined;
          if (!oldestKey) break;
          trackCache.delete(oldestKey);
        }

        setFetchedAtMs(fetchedAt);
        setTrack(nextTrack);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (process.env.NODE_ENV !== "production") {
          console.error("useFlightTrack: failed to fetch trace", err);
        }
      } finally {
        if (alive && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }

    const debounceMs = isKeyChange ? SELECTION_DEBOUNCE_MS : 0;
    const loadTimer = window.setTimeout(() => {
      void load();
    }, debounceMs);

    let interval: number | null = null;
    if (refreshMs > 0) {
      interval = window.setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void load();
      }, refreshMs);
    }

    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(loadTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (interval !== null) window.clearInterval(interval);
      setLoading(false);
    };
  }, [icao24, refreshMs, enabled]);

  return { track, loading, fetchedAtMs, rateLimited };
}

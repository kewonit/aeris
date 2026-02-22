"use client";

import { useEffect, useRef, useState } from "react";
import { fetchTrackByIcao24, type FlightTrack } from "@/lib/opensky";

type TrackCacheEntry = {
  fetchedAt: number;
  nextAllowedAt: number;
  track: FlightTrack | null;
};

// /tracks is expensive + rate-limited; cache aggressively.
const DEFAULT_REFRESH_MS = 0;
const TRACK_CACHE_TTL_MS_EFFECTIVE = 10 * 60_000;
const NEGATIVE_CACHE_TTL_MS_EFFECTIVE = 60_000;

const trackCache = new Map<string, TrackCacheEntry>();

// Global backoff for /tracks 429s.
let globalNextAllowedAt = 0;
let globalBackoffMs = 5 * 60_000;
const GLOBAL_BACKOFF_MAX_MS = 24 * 60 * 60_000;
const GLOBAL_BACKOFF_KEY = "aeris:opensky:tracksGlobalNextAllowedAt";
const GLOBAL_BACKOFF_MS_KEY = "aeris:opensky:tracksGlobalBackoffMs";
const SELECTION_DEBOUNCE_MS = 350;

function loadGlobalBackoff(): void {
  if (typeof window === "undefined") return;
  try {
    const nextAllowedRaw = sessionStorage.getItem(GLOBAL_BACKOFF_KEY);
    const nextAllowed = nextAllowedRaw ? Number.parseInt(nextAllowedRaw, 10) : 0;
    if (Number.isFinite(nextAllowed) && nextAllowed > 0) {
      globalNextAllowedAt = Math.max(globalNextAllowedAt, nextAllowed);
    }

    const backoffRaw = sessionStorage.getItem(GLOBAL_BACKOFF_MS_KEY);
    const backoff = backoffRaw ? Number.parseInt(backoffRaw, 10) : 0;
    if (Number.isFinite(backoff) && backoff > 0) {
      globalBackoffMs = Math.min(GLOBAL_BACKOFF_MAX_MS, Math.max(60_000, backoff));
    }
  } catch {
    // ignore
  }
}

function persistGlobalBackoff(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(GLOBAL_BACKOFF_KEY, String(globalNextAllowedAt));
    sessionStorage.setItem(GLOBAL_BACKOFF_MS_KEY, String(globalBackoffMs));
  } catch {
    // ignore
  }
}

function cacheTtlMs(track: FlightTrack | null): number {
  return track ? TRACK_CACHE_TTL_MS_EFFECTIVE : NEGATIVE_CACHE_TTL_MS_EFFECTIVE;
}

export function useFlightTrack(
  icao24: string | null,
  options?: {
    refreshMs?: number;
    enabled?: boolean;
  },
): { track: FlightTrack | null; loading: boolean; fetchedAtMs: number } {
  const refreshMs = options?.refreshMs ?? DEFAULT_REFRESH_MS;
  const enabled = options?.enabled ?? true;

  const [track, setTrack] = useState<FlightTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAtMs, setFetchedAtMs] = useState(0);

  const requestIdRef = useRef(0);
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    loadGlobalBackoff();

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

    // Stale-while-revalidate: keep cached track visible.
    if (hasCachedTrack) {
      setTrack(cached!.track);
      setFetchedAtMs(cached!.fetchedAt);
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

    async function load() {
      const now = Date.now();

      if (now < globalNextAllowedAt) {
        return;
      }

      const existing = trackCache.get(key);
      if (existing && now < existing.nextAllowedAt) {
        return;
      }

      if (existing && now - existing.fetchedAt <= cacheTtlMs(existing.track)) {
        return;
      }

      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const result = await fetchTrackByIcao24(key, 0, controller.signal);
        if (!alive || requestId !== requestIdRef.current) return;

        const fetchedAt = Date.now();
        const retryAfterSeconds =
          typeof result.retryAfterSeconds === "number" &&
          Number.isFinite(result.retryAfterSeconds)
            ? result.retryAfterSeconds
            : null;

        const rateLimitedBackoffMs =
          retryAfterSeconds && retryAfterSeconds > 0
            ? Math.max(1, retryAfterSeconds) * 1000
            : globalBackoffMs;

        const nextAllowedAt = result.rateLimited
          ? fetchedAt + rateLimitedBackoffMs
          : fetchedAt;

        if (result.rateLimited) {
          globalNextAllowedAt = Math.max(globalNextAllowedAt, nextAllowedAt);
          globalBackoffMs = Math.min(
            GLOBAL_BACKOFF_MAX_MS,
            Math.max(60_000, Math.floor(globalBackoffMs * 1.6)),
          );
          persistGlobalBackoff();
        }

        const existing = trackCache.get(key)?.track ?? null;
        const nextTrack = result.track ?? existing;

        trackCache.set(key, {
          fetchedAt,
          nextAllowedAt,
          track: nextTrack,
        });

        setFetchedAtMs(fetchedAt);

        setTrack(nextTrack);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        if (process.env.NODE_ENV !== "production") {
          console.error("useFlightTrack: failed to fetch track", err);
        }

        return;
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
        void load();
      }, refreshMs);
    }

    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(loadTimer);
      if (interval !== null) window.clearInterval(interval);
      setLoading(false);
    };
  }, [icao24, refreshMs, enabled]);

  return { track, loading, fetchedAtMs };
}

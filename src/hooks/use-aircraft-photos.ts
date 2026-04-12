"use client";

import { useState, useEffect } from "react";

// ── Exported types (unchanged for backward compatibility) ───────────────────

export type NormalizedPhoto = {
  id: string;
  url: string;
  thumbnail: string;
  photographer: string | null;
  location: string | null;
  dateTaken: string | null;
  link: string | null;
};

export type AircraftDetails = {
  registration: string;
  manufacturer: string | null;
  type: string | null;
  typeCode: string | null;
  owner: string | null;
  airline: string | null;
};

export type UseAircraftPhotosResult = {
  photos: NormalizedPhoto[];
  aircraft: AircraftDetails | null;
  loading: boolean;
  error: boolean;
};

// ── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 2 * 60_000;
const CACHE_MAX = 200;
const FETCH_TIMEOUT_MS = 15_000;

type CacheEntry = {
  aircraft: AircraftDetails | null;
  photos: NormalizedPhoto[];
  ts: number;
  ttl: number;
  failed: boolean;
};

const cache = new Map<string, CacheEntry>();

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function putCache(
  key: string,
  aircraft: AircraftDetails | null,
  photos: NormalizedPhoto[],
  failed = false,
): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, {
    aircraft,
    photos,
    ts: Date.now(),
    ttl: photos.length > 0 ? CACHE_TTL_MS : NEGATIVE_TTL_MS,
    failed,
  });
}

export function deriveAircraftPhotosFlags(params: {
  hasIcao24: boolean;
  fallbackResult: Pick<CacheEntry, "failed"> | null;
  cacheKey: string | null;
  errorKey: string | null;
  resolvedKey: string | null;
}): { loading: boolean; error: boolean } {
  if (!params.hasIcao24) {
    return { loading: false, error: false };
  }

  const hasFallbackResult = params.fallbackResult !== null;

  return {
    loading:
      !hasFallbackResult &&
      params.cacheKey !== params.errorKey &&
      params.cacheKey !== params.resolvedKey,
    error:
      Boolean(params.fallbackResult?.failed) ||
      (!hasFallbackResult && params.cacheKey === params.errorKey),
  };
}

// ── API response types ───────────────────────────────────────────────────────────

type ApiPhoto = {
  id: string;
  url: string;
  thumbnail: string;
  photographer: string | null;
  location: string | null;
  dateTaken: string | null;
  link: string | null;
};

type ApiAircraft = {
  registration: string;
  manufacturer: string | null;
  type: string | null;
  typeCode: string | null;
  owner: string | null;
};

type ApiResponse = {
  photos?: ApiPhoto[];
  aircraft?: ApiAircraft | null;
};

// ── Fetcher ─────────────────────────────────────────────────────────────────

type FetchResult = {
  aircraft: AircraftDetails | null;
  photos: NormalizedPhoto[];
};

async function fetchPhotos(
  icao24: string,
  reg: string | null,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    let url = `/api/aircraft-photos?hex=${encodeURIComponent(icao24)}`;
    if (reg) url += `&reg=${encodeURIComponent(reg)}`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return { aircraft: null, photos: [] };

    const data = (await res.json()) as ApiResponse;

    const photos: NormalizedPhoto[] = (data.photos ?? [])
      .filter(
        (p): p is ApiPhoto =>
          typeof p?.id === "string" &&
          typeof p?.url === "string" &&
          p.url.length > 0,
      )
      .map((p) => ({
        id: p.id,
        url: p.url,
        thumbnail: p.thumbnail || p.url,
        photographer: p.photographer ?? null,
        location: p.location ?? null,
        dateTaken: p.dateTaken ?? null,
        link: p.link ?? null,
      }));

    let aircraft: AircraftDetails | null = null;
    if (data.aircraft && typeof data.aircraft.registration === "string") {
      aircraft = {
        registration: data.aircraft.registration,
        manufacturer: data.aircraft.manufacturer ?? null,
        type: data.aircraft.type ?? null,
        typeCode: data.aircraft.typeCode ?? null,
        owner: data.aircraft.owner ?? null,
        airline: data.aircraft.owner ?? null,
      };
    }

    return { aircraft, photos };
  } catch (err) {
    // Don't throw on intentional aborts — return empty result
    if (err instanceof DOMException && err.name === "AbortError") {
      return { aircraft: null, photos: [] };
    }
    // Re-throw network/parse failures so callers can set error state
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAircraftPhotos(
  icao24: string | null,
  registration?: string | null,
): UseAircraftPhotosResult {
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const hasIcao24 = Boolean(icao24);
  const normalized = icao24?.toLowerCase() ?? null;
  const reg = registration?.trim().toUpperCase() || null;
  const cacheKey = normalized
    ? reg
      ? `${normalized}:${reg}`
      : normalized
    : null;
  const cached = cacheKey ? getCached(cacheKey) : null;
  const hexCached = normalized && reg ? getCached(normalized) : null;
  const fallbackResult = cached ?? hexCached;

  useEffect(() => {
    if (!hasIcao24 || !normalized || !cacheKey) {
      return;
    }

    if (cached) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    if (reg && !hexCached) {
      // Phase 1: Fast sources (no JetAPI) → show immediately
      // Phase 2: All sources including JetAPI → upgrade
      fetchPhotos(normalized, null, controller.signal).then(
        (fastResult) => {
          if (cancelled) return;
          putCache(normalized, fastResult.aircraft, fastResult.photos);
          setResolvedKey(normalized);

          // Phase 2: fetch with registration to include JetAPI
          fetchPhotos(normalized, reg, controller.signal).then(
            (fullResult) => {
              if (cancelled) return;
              const mergedAircraft = fullResult.aircraft ?? fastResult.aircraft;
              putCache(cacheKey, mergedAircraft, fullResult.photos);
              setResolvedKey(cacheKey);
            },
            () => {
              // JetAPI failed — keep fast results
              if (!cancelled) {
                putCache(cacheKey, fastResult.aircraft, fastResult.photos);
                setResolvedKey(cacheKey);
              }
            },
          );
        },
        () => {
          if (cancelled) return;
          putCache(normalized, null, [], true);
          setErrorKey(cacheKey);
        },
      );
    } else if (reg && hexCached) {
      // Already showing hex-only cache — just fetch JetAPI enhancement
      fetchPhotos(normalized, reg, controller.signal).then(
        (fullResult) => {
          if (cancelled) return;
          const mergedAircraft = fullResult.aircraft ?? hexCached.aircraft;
          putCache(cacheKey, mergedAircraft, fullResult.photos);
          setResolvedKey(cacheKey);
        },
        () => {
          // JetAPI failed — keep cached results
          if (!cancelled) {
            putCache(cacheKey, hexCached.aircraft, hexCached.photos);
            setResolvedKey(cacheKey);
          }
        },
      );
    } else {
      // No registration — fast sources only
      fetchPhotos(normalized, null, controller.signal).then(
        (result) => {
          if (cancelled) return;
          putCache(normalized, result.aircraft, result.photos);
          setResolvedKey(normalized);
        },
        () => {
          if (cancelled) return;
          putCache(normalized, null, [], true);
          setErrorKey(cacheKey);
        },
      );
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cacheKey, hasIcao24, normalized, reg]);

  if (!hasIcao24) {
    return { photos: [], aircraft: null, loading: false, error: false };
  }

  const { loading, error } = deriveAircraftPhotosFlags({
    hasIcao24,
    fallbackResult,
    cacheKey,
    errorKey,
    resolvedKey,
  });

  return {
    photos: fallbackResult?.photos ?? [],
    aircraft: fallbackResult?.aircraft ?? null,
    loading,
    error,
  };
}

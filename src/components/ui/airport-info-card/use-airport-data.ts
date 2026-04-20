"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AirportPhoto, MetarData, TafData } from "./types";
import {
  getFreshMetar,
  getFreshPhoto,
  getFreshTaf,
  metarCache,
  rememberMetar,
  rememberPhoto,
  rememberTaf,
} from "./caches";

type MetarState = {
  metar: MetarData | null;
  loading: boolean;
};

/** Fetches METAR for the given ICAO with in-memory cache and abort on change. */
export function useMetar(icao: string | null): MetarState {
  const [metar, setMetar] = useState<MetarData | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMetar = useCallback(async (code: string) => {
    const fresh = getFreshMetar(code);
    if (fresh) {
      setMetar(fresh);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    // If we have stale data, keep showing it while we refresh.
    const stale = metarCache.get(code);
    setMetar(stale?.data ?? null);

    try {
      const res = await fetch(
        `/api/weather/metar?icao=${encodeURIComponent(code)}`,
        { signal: controller.signal },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (controller.signal.aborted) return;
      const obs = Array.isArray(data) ? data[0] : data;
      if (obs) rememberMetar(code, obs);
      setMetar(obs ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!icao) {
      setMetar(null);
      setLoading(false);
      return;
    }
    fetchMetar(icao);
    return () => abortRef.current?.abort();
  }, [icao, fetchMetar]);

  return { metar, loading };
}

type TafState = {
  taf: TafData | null;
  loading: boolean;
};

export async function requestTaf(
  code: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ taf: TafData | null; cacheable: boolean }> {
  const res = await fetchImpl(
    `/api/weather/taf?icao=${encodeURIComponent(code)}`,
    { signal },
  );

  if (!res.ok) {
    return { taf: null, cacheable: false };
  }

  const data = await res.json();
  const obs = Array.isArray(data) ? data[0] : data;

  return { taf: obs ?? null, cacheable: true };
}

/** Fetches TAF for the given ICAO. Caches successful empty results as well. */
export function useTaf(icao: string | null): TafState {
  const [taf, setTaf] = useState<TafData | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchTaf = useCallback(async (code: string) => {
    const fresh = getFreshTaf(code);
    if (fresh !== undefined) {
      setTaf(fresh);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setTaf(null);

    try {
      const data = await requestTaf(code, controller.signal);
      if (controller.signal.aborted) return;

      if (data.cacheable) {
        rememberTaf(code, data.taf);
      }

      setTaf(data.taf);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!icao) {
      setTaf(null);
      setLoading(false);
      return;
    }
    fetchTaf(icao);
    return () => abortRef.current?.abort();
  }, [icao, fetchTaf]);

  return { taf, loading };
}

type PhotoState = {
  photo: AirportPhoto | null;
  loading: boolean;
  errored: boolean;
  markErrored: () => void;
};

export type AirportPhotoRequest = {
  name: string;
  iata?: string | null;
  icao?: string | null;
  city?: string | null;
};

type AirportPhotoLookup = AirportPhotoRequest & {
  cacheKey: string;
};

function buildAirportPhotoUrl(request: string | AirportPhotoRequest): string {
  const params = new URLSearchParams();

  if (typeof request === "string") {
    params.set("name", request);
  } else {
    params.set("name", request.name);
    if (request.iata) params.set("iata", request.iata);
    if (request.icao) params.set("icao", request.icao);
    if (request.city) params.set("city", request.city);
  }

  return `/api/airport-photo?${params.toString()}`;
}

export async function requestAirportPhoto(
  request: string | AirportPhotoRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ photo: AirportPhoto | null; cacheable: boolean }> {
  const res = await fetchImpl(buildAirportPhotoUrl(request), { signal });

  if (!res.ok) {
    return { photo: null, cacheable: false };
  }

  const data = (await res.json()) as { photo: AirportPhoto | null };
  return { photo: data.photo, cacheable: true };
}

/** Fetches a Wikipedia photo for the airport. `cacheKey` keys the cache
 *  (prefer ICAO when available); `query` is sent to the server. */
export function useAirportPhoto(lookup: AirportPhotoLookup | null): PhotoState {
  const [photo, setPhoto] = useState<AirportPhoto | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPhoto = useCallback(async (nextLookup: AirportPhotoLookup) => {
    const fresh = getFreshPhoto(nextLookup.cacheKey);
    if (fresh !== undefined) {
      setPhoto(fresh);
      setLoading(false);
      setErrored(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setErrored(false);
    setPhoto(null);

    try {
      const { cacheKey, ...request } = nextLookup;
      const data = await requestAirportPhoto(request, controller.signal);
      if (controller.signal.aborted) return;

      if (data.cacheable) {
        rememberPhoto(cacheKey, data.photo);
      }

      setPhoto(data.photo);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!lookup) {
      setPhoto(null);
      setLoading(false);
      setErrored(false);
      return;
    }
    fetchPhoto(lookup);
    return () => abortRef.current?.abort();
  }, [lookup, fetchPhoto]);

  return {
    photo,
    loading,
    errored,
    markErrored: useCallback(() => setErrored(true), []),
  };
}

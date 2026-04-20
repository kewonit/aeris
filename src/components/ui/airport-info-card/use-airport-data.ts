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

/** Fetches TAF for the given ICAO. Caches absence as well to avoid refetching. */
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
      const res = await fetch(
        `/api/weather/taf?icao=${encodeURIComponent(code)}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        rememberTaf(code, null);
        setTaf(null);
        return;
      }
      const data = await res.json();
      if (controller.signal.aborted) return;
      const obs = Array.isArray(data) ? data[0] : data;
      const resolved = obs ?? null;
      rememberTaf(code, resolved);
      setTaf(resolved);
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

/** Fetches a Wikipedia photo for the airport. `cacheKey` keys the cache
 *  (prefer ICAO when available); `query` is sent to the server. */
export function useAirportPhoto(
  cacheKey: string | null,
  query: string | null,
): PhotoState {
  const [photo, setPhoto] = useState<AirportPhoto | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPhoto = useCallback(async (key: string, q: string) => {
    const fresh = getFreshPhoto(key);
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
      const res = await fetch(
        `/api/airport-photo?name=${encodeURIComponent(q)}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        rememberPhoto(key, null);
        return;
      }
      const data = (await res.json()) as { photo: AirportPhoto | null };
      if (controller.signal.aborted) return;
      rememberPhoto(key, data.photo);
      setPhoto(data.photo);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cacheKey || !query) {
      setPhoto(null);
      setLoading(false);
      setErrored(false);
      return;
    }
    fetchPhoto(cacheKey, query);
    return () => abortRef.current?.abort();
  }, [cacheKey, query, fetchPhoto]);

  return {
    photo,
    loading,
    errored,
    markErrored: useCallback(() => setErrored(true), []),
  };
}

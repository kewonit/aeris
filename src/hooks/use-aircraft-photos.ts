"use client";

import { useState, useEffect } from "react";

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

const CACHE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 2 * 60_000;
const CACHE_MAX = 200;
const FETCH_TIMEOUT_MS = 10_000;

type CacheEntry = {
  aircraft: AircraftDetails | null;
  photos: NormalizedPhoto[];
  ts: number;
  ttl: number;
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
  });
}

type FetchResult = {
  aircraft: AircraftDetails | null;
  photos: NormalizedPhoto[];
};

async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

type HexDbAircraft = {
  ModeS?: string;
  Registration?: string;
  Manufacturer?: string;
  ICAOTypeCode?: string;
  Type?: string;
  RegisteredOwners?: string;
  OperatorFlagCode?: string;
};

async function fetchAircraftDetails(
  icao24: string,
  signal?: AbortSignal,
): Promise<AircraftDetails | null> {
  const data = await fetchJson<HexDbAircraft>(
    `https://hexdb.io/api/v1/aircraft/${encodeURIComponent(icao24)}`,
    signal,
  );

  if (!data?.Registration) return null;

  return {
    registration: data.Registration,
    manufacturer: data.Manufacturer ?? null,
    type: data.Type ?? null,
    typeCode: data.ICAOTypeCode ?? null,
    owner: data.RegisteredOwners ?? null,
    airline: null,
  };
}

type JetApiImage = {
  Image?: string;
  Thumbnail?: string;
  Link?: string;
  Photographer?: string;
  Location?: string;
  DateTaken?: string;
  Aircraft?: string;
  Airline?: string;
};

type JetApiResponse = {
  JetPhotos?: {
    Reg?: string;
    Images?: JetApiImage[];
  };
  FlightRadar?: {
    Aircraft?: string;
    Airline?: string;
    Operator?: string;
    TypeCode?: string;
    ModeS?: string;
  };
};

function normalizePhotos(raw: JetApiImage[] | undefined): NormalizedPhoto[] {
  if (!raw || !Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: NormalizedPhoto[] = [];

  for (const img of raw) {
    const fullUrl = typeof img.Image === "string" ? img.Image : null;
    if (!fullUrl) continue;

    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    const thumb =
      typeof img.Thumbnail === "string" && img.Thumbnail
        ? img.Thumbnail
        : fullUrl;

    out.push({
      id: `jp-${out.length}-${fullUrl.slice(-16).replace(/[^a-zA-Z0-9]/g, "")}`,
      url: fullUrl,
      thumbnail: thumb,
      photographer:
        typeof img.Photographer === "string" && img.Photographer
          ? img.Photographer
          : null,
      location:
        typeof img.Location === "string" && img.Location ? img.Location : null,
      dateTaken:
        typeof img.DateTaken === "string" && img.DateTaken
          ? img.DateTaken
          : null,
      link: typeof img.Link === "string" && img.Link ? img.Link : null,
    });
  }

  return out;
}

async function fetchPhotosViaProxy(
  reg: string,
  signal?: AbortSignal,
): Promise<{ photos: NormalizedPhoto[]; airline: string | null }> {
  const data = await fetchJson<JetApiResponse>(
    `/api/aircraft-photos?reg=${encodeURIComponent(reg)}`,
    signal,
  );

  if (!data) return { photos: [], airline: null };

  const photos = normalizePhotos(data.JetPhotos?.Images);
  const airline =
    typeof data.FlightRadar?.Airline === "string"
      ? data.FlightRadar.Airline
      : null;

  return { photos, airline };
}

async function fetchAll(
  icao24: string,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const aircraft = await fetchAircraftDetails(icao24, signal);
  if (!aircraft) return { aircraft: null, photos: [] };

  const { photos, airline } = await fetchPhotosViaProxy(
    aircraft.registration,
    signal,
  );

  const enriched: AircraftDetails = {
    ...aircraft,
    airline: airline ?? aircraft.owner,
  };

  return { aircraft: enriched, photos };
}

export function useAircraftPhotos(
  icao24: string | null,
): UseAircraftPhotosResult {
  const [photos, setPhotos] = useState<NormalizedPhoto[]>([]);
  const [aircraft, setAircraft] = useState<AircraftDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!icao24) {
      setPhotos([]);
      setAircraft(null);
      setLoading(false);
      setError(false);
      return;
    }

    const normalized = icao24.toLowerCase();

    const cached = getCached(normalized);
    if (cached) {
      setPhotos(cached.photos);
      setAircraft(cached.aircraft);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setLoading(true);
    setError(false);
    setPhotos([]);
    setAircraft(null);

    fetchAll(normalized, controller.signal).then(
      (result) => {
        if (cancelled) return;
        putCache(normalized, result.aircraft, result.photos);
        setPhotos(result.photos);
        setAircraft(result.aircraft);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        putCache(normalized, null, []);
        setLoading(false);
        setError(true);
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [icao24]);

  return { photos, aircraft, loading, error };
}

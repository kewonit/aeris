import type { MetarData, TafData, AirportPhoto } from "./types";

// ── Cache TTLs ─────────────────────────────────────────────────────────
// METAR: 10 minutes (observations update ~hourly, refresh aggressively)
// TAF:   30 minutes (forecasts valid for hours)
// Photo: 7 days (largely static, server also edge-caches 7 days)

const METAR_TTL_MS = 10 * 60 * 1000;
const TAF_TTL_MS = 30 * 60 * 1000;
const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Persistent cache (localStorage) — survives reloads.
// Version bump invalidates all previously stored entries.
const PHOTO_LS_KEY = "aeris:photo-cache:v1";
const PHOTO_LS_MAX_ENTRIES = 200;

type PhotoEntry = { data: AirportPhoto | null; fetchedAt: number };

export const metarCache = new Map<
  string,
  { data: MetarData; fetchedAt: number }
>();
export const tafCache = new Map<
  string,
  { data: TafData | null; fetchedAt: number }
>();
export const photoCache = new Map<string, PhotoEntry>();

// ── Photo persistence ──────────────────────────────────────────────────

/**
 * Safely access localStorage. Returns null in SSR, private mode,
 * or when disabled by user / quota exhausted.
 */
function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = window.localStorage;
    // Cheap probe — some browsers throw on access in private mode.
    const probe = "__aeris_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

let photoCacheHydrated = false;

function hydratePhotoCache(): void {
  if (photoCacheHydrated) return;
  photoCacheHydrated = true;
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    const raw = ls.getItem(PHOTO_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PhotoEntry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v &&
        typeof v.fetchedAt === "number" &&
        now - v.fetchedAt <= PHOTO_TTL_MS
      ) {
        photoCache.set(k, v);
      }
    }
  } catch {
    try {
      ls.removeItem(PHOTO_LS_KEY);
    } catch {
      /* ignore */
    }
  }
}

function persistPhotoCache(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    // Cap entries — evict oldest first.
    const entries = [...photoCache.entries()];
    if (entries.length > PHOTO_LS_MAX_ENTRIES) {
      entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
      entries.length = PHOTO_LS_MAX_ENTRIES;
      photoCache.clear();
      for (const [k, v] of entries) photoCache.set(k, v);
    }
    const snapshot: Record<string, PhotoEntry> = {};
    for (const [k, v] of photoCache) snapshot[k] = v;
    ls.setItem(PHOTO_LS_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded or other — drop persistence silently.
    try {
      ls.removeItem(PHOTO_LS_KEY);
    } catch {
      /* ignore */
    }
  }
}

// ── Public accessors ───────────────────────────────────────────────────

export function getFreshMetar(icao: string): MetarData | null {
  const cached = metarCache.get(icao);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > METAR_TTL_MS) return null;
  return cached.data;
}

export function getFreshTaf(icao: string): TafData | null | undefined {
  const cached = tafCache.get(icao);
  if (!cached) return undefined;
  if (Date.now() - cached.fetchedAt > TAF_TTL_MS) return undefined;
  return cached.data;
}

export function getFreshPhoto(key: string): AirportPhoto | null | undefined {
  hydratePhotoCache();
  const cached = photoCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.fetchedAt > PHOTO_TTL_MS) {
    photoCache.delete(key);
    persistPhotoCache();
    return undefined;
  }
  return cached.data;
}

export function rememberMetar(icao: string, data: MetarData): void {
  metarCache.set(icao, { data, fetchedAt: Date.now() });
}
export function rememberTaf(icao: string, data: TafData | null): void {
  tafCache.set(icao, { data, fetchedAt: Date.now() });
}
export function rememberPhoto(key: string, data: AirportPhoto | null): void {
  hydratePhotoCache();
  photoCache.set(key, { data, fetchedAt: Date.now() });
  persistPhotoCache();
}

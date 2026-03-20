const MAX_LOADED_URLS = 1000;
export const loadedAirlineLogoUrls = new Set<string>();

/**
 * Track a successfully loaded logo URL. Evicts oldest entry when the
 * Set exceeds MAX_LOADED_URLS to prevent unbounded growth.
 */
export function trackAirlineLogoLoaded(url: string): void {
  if (!url) return;
  loadedAirlineLogoUrls.add(url);
  if (loadedAirlineLogoUrls.size > MAX_LOADED_URLS) {
    // Set iterates in insertion order — first entry is oldest
    const oldest = loadedAirlineLogoUrls.values().next().value;
    if (oldest) loadedAirlineLogoUrls.delete(oldest);
  }
}

const FAILED_TTL_MS = 10 * 60_000;
const MAX_FAILED_ENTRIES = 500;
const failedAirlineLogoTimestamps = new Map<string, number>();

export function wasAirlineLogoRecentlyFailed(url: string): boolean {
  if (!url) return false;
  const ts = failedAirlineLogoTimestamps.get(url);
  if (ts === undefined) return false;
  if (Date.now() - ts > FAILED_TTL_MS) {
    failedAirlineLogoTimestamps.delete(url);
    return false;
  }
  return true;
}

export function markAirlineLogoFailed(url: string): void {
  if (!url) return;
  const now = Date.now();
  failedAirlineLogoTimestamps.set(url, now);

  // Prune expired entries
  for (const [key, ts] of failedAirlineLogoTimestamps) {
    if (now - ts > FAILED_TTL_MS) {
      failedAirlineLogoTimestamps.delete(key);
    }
  }

  // Evict oldest if over limit — Map iterates in insertion order
  if (failedAirlineLogoTimestamps.size > MAX_FAILED_ENTRIES) {
    const oldest = failedAirlineLogoTimestamps.keys().next().value;
    if (oldest) failedAirlineLogoTimestamps.delete(oldest);
  }
}

export const loadedAirlineLogoUrls = new Set<string>();

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

  // Opportunistically prune expired entries so the cache doesn't skew toward old URLs.
  for (const [key, ts] of failedAirlineLogoTimestamps) {
    if (now - ts > FAILED_TTL_MS) {
      failedAirlineLogoTimestamps.delete(key);
    }
  }

  if (failedAirlineLogoTimestamps.size <= MAX_FAILED_ENTRIES) return;

  let oldestUrl: string | null = null;
  let oldestTs = Number.POSITIVE_INFINITY;
  for (const [key, ts] of failedAirlineLogoTimestamps) {
    if (ts < oldestTs) {
      oldestTs = ts;
      oldestUrl = key;
    }
  }
  if (oldestUrl) failedAirlineLogoTimestamps.delete(oldestUrl);
}

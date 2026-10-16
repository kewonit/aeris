import { TRAIL_NEGATIVE_TTLS_MS } from "../constants";

/** The next negative-cache backoff step after `previousMs`, capped at the last. */
export function getNextNegativeBackoffMs(previousMs: number): number {
  for (const ttl of TRAIL_NEGATIVE_TTLS_MS) {
    if (ttl > previousMs) {
      return ttl;
    }
  }

  return TRAIL_NEGATIVE_TTLS_MS[TRAIL_NEGATIVE_TTLS_MS.length - 1];
}

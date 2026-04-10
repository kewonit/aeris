import { TRAIL_NEGATIVE_TTLS_MS } from "../constants";
import type { TraceProviderId } from "../providers";

export type ProviderHealth = {
  id: TraceProviderId;
  errorStreak: number;
  cooldownUntil: number;
  lastSuccessAt: number;
  lastLatencyMs: number | null;
};

export function getNextNegativeBackoffMs(previousMs: number): number {
  for (const ttl of TRAIL_NEGATIVE_TTLS_MS) {
    if (ttl > previousMs) {
      return ttl;
    }
  }

  return TRAIL_NEGATIVE_TTLS_MS[TRAIL_NEGATIVE_TTLS_MS.length - 1];
}

function getCurrentNegativeBackoffMs(errorStreak: number): number {
  if (errorStreak <= 0) {
    return 0;
  }

  const index = Math.min(errorStreak - 1, TRAIL_NEGATIVE_TTLS_MS.length - 1);
  return TRAIL_NEGATIVE_TTLS_MS[index];
}

export function noteProviderFailure(
  state: ProviderHealth,
  params: {
    now: number;
    retryAfterMs?: number;
  },
): ProviderHealth {
  const retryAfterMs =
    params.retryAfterMs ??
    getNextNegativeBackoffMs(getCurrentNegativeBackoffMs(state.errorStreak));

  return {
    ...state,
    errorStreak: state.errorStreak + 1,
    cooldownUntil: params.now + retryAfterMs,
  };
}

export function noteProviderSuccess(
  state: ProviderHealth,
  params: {
    now: number;
    latencyMs: number;
  },
): ProviderHealth {
  return {
    ...state,
    errorStreak: 0,
    cooldownUntil: 0,
    lastSuccessAt: params.now,
    lastLatencyMs: params.latencyMs,
  };
}

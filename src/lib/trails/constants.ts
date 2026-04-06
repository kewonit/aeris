export const TRAIL_HISTORY_REFRESH_MS = 15_000;
export const TRAIL_POSITIVE_TTL_MS = 15_000;
export const TRAIL_NEGATIVE_TTLS_MS = [
  30_000, 60_000, 120_000, 300_000,
] as const;
export const TRAIL_DEFAULT_RETRY_MS = 60_000;

export const SNAP_JOIN_DEG = 0.15;
export const TRIM_AND_BRIDGE_DEG = 1.5;
export const CONNECT_BRIDGE_DEG = 0.15;
export const HARD_DISCONNECT_BASE_DEG = 1.0;
export const LOW_ALTITUDE_THRESHOLD_M = 6_000;
export const MAX_GAP_LOW_ALT_DEG = 2.5;
export const MAX_GAP_HIGH_ALT_DEG = 5.0;
export const STALE_DISCONNECT_GAP_DEG = 0.5;
export const STALE_DISCONNECT_AGE_SEC = 1_800;
export const MODERATE_DISCONNECT_GAP_DEG = 0.8;
export const MODERATE_DISCONNECT_AGE_SEC = 600;
export const SELECTED_TRAIL_GRACE_MS = 30_000;
export const TRACK_REJECT_LOW_ALT_DEG = 4.0;
export const TRACK_REJECT_HIGH_ALT_DEG = 8.0;

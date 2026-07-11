export const MAX_ACTIVE_FRAME_RATE = 30;
export const ACTIVE_FRAME_INTERVAL_MS = 1000 / MAX_ACTIVE_FRAME_RATE;
export const OVERVIEW_FRAME_RATE = 20;
export const OVERVIEW_FRAME_INTERVAL_MS = 1000 / OVERVIEW_FRAME_RATE;

export function isFrameDue(
  lastRenderedAt: number,
  now: number,
  intervalMs: number = ACTIVE_FRAME_INTERVAL_MS,
): boolean {
  if (lastRenderedAt <= 0) return true;
  if (!Number.isFinite(now) || !Number.isFinite(lastRenderedAt)) return true;
  return now - lastRenderedAt >= intervalMs;
}

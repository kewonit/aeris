export const MAX_ACTIVE_FRAME_RATE = 30;
export const ACTIVE_FRAME_INTERVAL_MS = 1000 / MAX_ACTIVE_FRAME_RATE;
export const OVERVIEW_FRAME_RATE = 20;
export const OVERVIEW_FRAME_INTERVAL_MS = 1000 / OVERVIEW_FRAME_RATE;
/**
 * While the camera moves, layers rebuild at up to this rate so sizes and
 * trail joins that depend on the camera keep up with it.
 */
export const CAMERA_FRAME_RATE = 60;
/** A little under 60 fps, so a 120 Hz display rebuilds every other frame. */
export const CAMERA_FRAME_INTERVAL_MS = (1000 / CAMERA_FRAME_RATE) * 0.8;
/**
 * First person view redraws the map and every aircraft each frame for as
 * long as it is open, which at 60 fps keeps the GPU and the fans busy.
 * This rate is every third frame on a 120 Hz display and every other
 * frame on a 60 Hz one, so frames stay evenly spaced either way.
 */
export const FPV_FRAME_RATE = 40;
export const FPV_FRAME_INTERVAL_MS = (1000 / FPV_FRAME_RATE) * 0.8;

/**
 * How long to wait between layer rebuilds. The follow camera moves with
 * the aircraft each time it is redrawn, so this is also the camera's rate.
 */
export function frameIntervalMs({
  fpv,
  cameraMoving,
}: {
  fpv: boolean;
  cameraMoving: boolean;
}): number {
  if (fpv) return FPV_FRAME_INTERVAL_MS;
  return cameraMoving ? CAMERA_FRAME_INTERVAL_MS : OVERVIEW_FRAME_INTERVAL_MS;
}

export function isFrameDue(
  lastRenderedAt: number,
  now: number,
  intervalMs: number = ACTIVE_FRAME_INTERVAL_MS,
): boolean {
  if (lastRenderedAt <= 0) return true;
  if (!Number.isFinite(now) || !Number.isFinite(lastRenderedAt)) return true;
  return now - lastRenderedAt >= intervalMs;
}

export const MAX_ACTIVE_FRAME_RATE = 30;
export const ACTIVE_FRAME_INTERVAL_MS = 1000 / MAX_ACTIVE_FRAME_RATE;
export const OVERVIEW_FRAME_RATE = 20;
export const OVERVIEW_FRAME_INTERVAL_MS = 1000 / OVERVIEW_FRAME_RATE;
/**
 * Zoomed out, an airliner crosses a pixel or two a second, and redrawing
 * it twenty times a second moves it a fraction of a pixel each time that
 * nobody can see. The overview is paced so that the fastest aircraft moves
 * about this far between redraws, measured at the map's centre; the near
 * edge of a tilted map moves up to twice as far...
 */
export const OVERVIEW_STEP_PX = 0.3;
/** ...and never slower than this, so a change is not long in showing. */
export const MIN_OVERVIEW_FRAME_RATE = 4;

/** The overview's redraw interval when its fastest aircraft moves this fast. */
export function overviewFrameIntervalMs(maxPixelsPerSecond: number): number {
  if (!(maxPixelsPerSecond > 0)) return 1000 / MIN_OVERVIEW_FRAME_RATE;
  const rate = Math.min(
    OVERVIEW_FRAME_RATE,
    Math.max(MIN_OVERVIEW_FRAME_RATE, maxPixelsPerSecond / OVERVIEW_STEP_PX),
  );
  return 1000 / rate;
}
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
 *
 * @param fading Something besides aircraft motion is animating, such as a
 *   selection fading, which wants the full overview rate.
 * @param maxPixelsPerSecond How fast the fastest aircraft crosses the
 *   screen, which paces the overview (overviewFrameIntervalMs).
 */
export function frameIntervalMs({
  fpv,
  cameraMoving,
  fading = false,
  maxPixelsPerSecond = Infinity,
}: {
  fpv: boolean;
  cameraMoving: boolean;
  fading?: boolean;
  maxPixelsPerSecond?: number;
}): number {
  if (fpv) return FPV_FRAME_INTERVAL_MS;
  if (cameraMoving) return CAMERA_FRAME_INTERVAL_MS;
  if (fading) return OVERVIEW_FRAME_INTERVAL_MS;
  return overviewFrameIntervalMs(maxPixelsPerSecond);
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

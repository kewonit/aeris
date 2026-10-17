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
 * In first person view the aircraft holds still on screen and the ground
 * streams past beneath it, fast on final approach and barely at cruise.
 * The view is paced so the nearest ground moves about this far between
 * frames: the full camera rate low down, where steps would show, and as
 * little as the floor high up, where they cannot.
 */
export const FPV_STEP_PX = 1.5;
export const MIN_FPV_FRAME_RATE = 24;

/** First person view's redraw interval when the ground goes by this fast. */
export function fpvFrameIntervalMs(groundPixelsPerSecond: number): number {
  if (!(groundPixelsPerSecond > 0)) return 1000 / MIN_FPV_FRAME_RATE;
  const rate = Math.min(
    CAMERA_FRAME_RATE,
    Math.max(MIN_FPV_FRAME_RATE, groundPixelsPerSecond / FPV_STEP_PX),
  );
  return rate === CAMERA_FRAME_RATE ? CAMERA_FRAME_INTERVAL_MS : 1000 / rate;
}

/**
 * How long to wait between layer rebuilds. The follow camera moves with
 * the aircraft each time it is redrawn, so this is also the camera's rate;
 * in first person view only the followed aircraft is rebuilt at it, and
 * the rest of the traffic at the overview's.
 *
 * @param fading Something besides aircraft motion is animating, such as a
 *   selection fading, which wants the full overview rate.
 * @param maxPixelsPerSecond How fast the fastest aircraft crosses the
 *   screen, which paces the overview (overviewFrameIntervalMs).
 * @param groundPixelsPerSecond How fast the nearest ground crosses the
 *   screen, which paces first person view (fpvFrameIntervalMs).
 */
export function frameIntervalMs({
  fpv,
  cameraMoving,
  fading = false,
  maxPixelsPerSecond = Infinity,
  groundPixelsPerSecond = Infinity,
}: {
  fpv: boolean;
  cameraMoving: boolean;
  fading?: boolean;
  maxPixelsPerSecond?: number;
  groundPixelsPerSecond?: number;
}): number {
  if (fpv) return fpvFrameIntervalMs(groundPixelsPerSecond);
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

/** The heights a sheet rests at. */
export type Detent = "peek" | "half" | "full";

/** Below this gap a half height would barely differ from the peek. */
const MIN_STEP_PX = 48;

/**
 * Where the sheet's top sits, as an offset down from fully open, for each
 * resting height. `height` is the open sheet's height, `viewport` the
 * screen's, and `peek` how much of the sheet shows at rest.
 */
export function sheetDetents({
  height,
  viewport,
  peek,
}: {
  height: number;
  viewport: number;
  peek: number;
}): Record<Detent, number> {
  const peekY = Math.max(0, height - peek);
  const halfY = Math.min(peekY, Math.max(0, height - viewport * 0.5));
  return { full: 0, half: halfY, peek: peekY };
}

/** The resting height nearest an offset, skipping a half too close to peek. */
export function nearestDetent(
  detents: Record<Detent, number>,
  offset: number,
): Detent {
  const candidates: Detent[] =
    detents.peek - detents.half < MIN_STEP_PX ? ["full", "peek"] : ["full", "half", "peek"];
  return candidates.reduce((best, detent) =>
    Math.abs(detents[detent] - offset) < Math.abs(detents[best] - offset) ? detent : best,
  );
}

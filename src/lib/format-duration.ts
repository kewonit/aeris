/**
 * A span of time in one style everywhere: "14 min", "1h", "1h 10m".
 *
 * Estimates of an hour or more round to five minutes, since a ground-speed
 * estimate is no better than that and a precise-looking number would
 * promise more than it knows.
 */
export function formatDuration(
  minutes: number,
  { estimate = false }: { estimate?: boolean } = {},
): string {
  let whole = Math.max(0, Math.round(minutes));
  if (estimate && whole >= 60) whole = Math.round(whole / 5) * 5;
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

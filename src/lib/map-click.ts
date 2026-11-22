/**
 * Runs `run` once every other listener has seen this map click, unless
 * one of them handled it by calling `preventDefault()`.
 *
 * MapLibre calls its click listeners in the order they were added, and the
 * map's components add theirs again whenever they re-render, so a listener
 * can't tell from its place whether an aircraft or an airport took the
 * click. MapLibre calls them all in one go, so a microtask runs after the
 * last.
 */
export function whenClickUnhandled(
  event: { readonly defaultPrevented: boolean },
  run: () => void,
): void {
  queueMicrotask(() => {
    if (!event.defaultPrevented) run();
  });
}

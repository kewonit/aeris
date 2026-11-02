import type { Parameters } from "@luma.gl/core";

/**
 * deck draws on the globe as a sphere up to this zoom. Past it, its globe
 * view hands over to a flat one, as the map's own globe flattens out.
 */
export const DECK_SPHERE_MAX_ZOOM = 12;

/**
 * Whether deck draws this frame on the sphere, which it does whenever the
 * map is a globe and the zoom is no further in than DECK_SPHERE_MAX_ZOOM.
 */
export function deckDrawsOnSphere(
  map: { getProjection(): { type?: unknown } | undefined },
  zoom: number,
): boolean {
  let type: unknown;
  try {
    type = map.getProjection()?.type;
  } catch {
    // The map has no style yet, so deck draws flat.
    return false;
  }
  return type === "globe" && zoom <= DECK_SPHERE_MAX_ZOOM;
}

/**
 * The extra turn, in degrees, that points an aircraft drawn on the sphere
 * along its track. On the sphere, deck lays a flat icon or a model out
 * with its x axis to the west and its y axis to the south, half a turn
 * from east and north on the flat map, so without it every nose points
 * backwards.
 */
export function sphereTurn(onSphere: boolean): number {
  return onSphere ? 180 : 0;
}

/** deck's counterclockwise icon angle for an aircraft flying `track`. */
export function aircraftIconAngle(track: number, onSphere: boolean): number {
  return (((360 - track + sphereTurn(onSphere)) % 360) + 360) % 360;
}

/**
 * For every icon layer. deck's globe view culls back faces, and an icon's
 * square faces away from it, so on the globe every aircraft icon, shadow,
 * and selection ring would be culled.
 */
export const ICON_PARAMETERS: Parameters = { cullMode: "none" };

import { MapView, _GlobeView as GlobeView } from "@deck.gl/core";
import type { MapLibreOverlayProps } from "@deck.gl/maplibre";
import type { Parameters } from "@luma.gl/core";

/**
 * deck draws on the globe as a sphere up to this zoom. Past it, its globe
 * view hands over to a flat one, as the map's own globe flattens out.
 */
export const DECK_SPHERE_MAX_ZOOM = 12;

/**
 * The id MapLibreOverlay gives the view it keeps in step with the map. A
 * view passed with this id takes its place; any other id would be drawn as
 * a second view beside it. The overlay doesn't export it.
 */
export const DECK_MAP_VIEW_ID = "maplibre";

/**
 * How near the globe view clips, in viewport heights of camera distance.
 * deck's default, 0.5, copies MapLibre's 0.5, but MapLibre's is in pixels:
 * at cruise it put the near plane about 8 km out, so the first person
 * aircraft, 2 to 4 km ahead of the camera, and its trail were clipped away.
 * 0.02 is MapLibre's own near plane on the flat map, a fiftieth of the
 * height. It carries on to the flat view the globe view uses past zoom 12.
 */
export const GLOBE_NEAR_Z_MULTIPLIER = 0.02;

const GLOBE_VIEW = new GlobeView({
  id: DECK_MAP_VIEW_ID,
  nearZMultiplier: GLOBE_NEAR_Z_MULTIPLIER,
});
const FLAT_VIEW = new MapView({ id: DECK_MAP_VIEW_ID });

/**
 * First person at this zoom or closer is drawn flat, even on the globe.
 *
 * On the sphere deck has no precise mode: it places every point in 32-bit
 * floats, about a metre apart, and so close to the camera the aircraft
 * shimmered, most of its edge pixels changing every frame. Flat, it is
 * drawn in metres around itself, and holds still. First person sits at
 * zoom 10.7 or more, where the map's own globe is all but flat: deck's flat
 * view and the map agree to a pixel over the lower half of the view and
 * part by a few only at the horizon. Below this zoom, as when a first
 * person link flies in from the whole globe, deck stays on the sphere.
 */
export const FIRST_PERSON_FLAT_MIN_ZOOM = 10;

type ProjectedMap = { getProjection(): { type?: unknown } | undefined };

function mapIsGlobe(map: ProjectedMap): boolean {
  try {
    return map.getProjection()?.type === "globe";
  } catch {
    // The map has no style yet, so deck draws flat.
    return false;
  }
}

function firstPersonDrawsFlat(firstPerson: boolean, zoom: number): boolean {
  return firstPerson && zoom >= FIRST_PERSON_FLAT_MIN_ZOOM;
}

/**
 * The view deck draws the map's traffic in: a globe on the globe, flat
 * otherwise, and flat in first person close in. Always one of two
 * instances, so handing it to deck every frame never reads as a change of
 * view.
 */
export function deckMapView(
  map: ProjectedMap,
  { firstPerson = false, zoom = 0 }: { firstPerson?: boolean; zoom?: number } = {},
): GlobeView | MapView {
  return mapIsGlobe(map) && !firstPersonDrawsFlat(firstPerson, zoom)
    ? GLOBE_VIEW
    : FLAT_VIEW;
}

/**
 * deckMapView as MapLibreOverlay props. The overlay reads `views` (a view
 * with DECK_MAP_VIEW_ID replaces its own), but its props type leaves them
 * at deck's default view type, null, so they are passed through here.
 */
export function overlayViewProps(
  map: ProjectedMap,
  options?: { firstPerson?: boolean; zoom?: number },
): Pick<MapLibreOverlayProps, "views"> {
  const view = deckMapView(map, options);
  return { views: view as unknown as MapLibreOverlayProps["views"] };
}

/**
 * Whether deck draws this frame on the sphere, which it does whenever the
 * map is a globe and the zoom is no further in than DECK_SPHERE_MAX_ZOOM,
 * except in first person close in (see FIRST_PERSON_FLAT_MIN_ZOOM).
 */
export function deckDrawsOnSphere(
  map: ProjectedMap,
  zoom: number,
  firstPerson = false,
): boolean {
  return (
    mapIsGlobe(map) &&
    zoom <= DECK_SPHERE_MAX_ZOOM &&
    !firstPersonDrawsFlat(firstPerson, zoom)
  );
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

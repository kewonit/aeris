import type maplibregl from "maplibre-gl";

export const BUILDINGS_3D_LAYER_ID = "aeris-buildings-3d";
export const BUILDINGS_3D_SOURCE_LAYER = "building";
export const BUILDINGS_3D_MIN_ZOOM = 15;

/**
 * Find the first vector source in a style. Reused by every layer that relies on
 * the base OMT-schema vector tiles that CARTO/OpenMapTiles-derived styles ship.
 * Returns `null` for raster-only styles (satellite, topo), which signals that
 * the caller should silently skip vector overlays.
 */
export function findVectorSource(map: maplibregl.Map): string | null {
  const style = map.getStyle();
  if (!style?.sources) return null;
  for (const [name, source] of Object.entries(style.sources)) {
    if (
      source &&
      typeof source === "object" &&
      "type" in source &&
      (source as { type: unknown }).type === "vector"
    ) {
      return name;
    }
  }
  return null;
}

/**
 * Build the paint spec for the 3D buildings layer.
 *
 * Height resolution uses `coalesce` to tolerate schema variants across
 * OpenMapTiles vendors: current OMT 3.x ships `render_height` /
 * `render_min_height`; older snapshots ship `height` / `min_height`. We fall
 * back to 0 so a missing property yields an invisible (flat) building rather
 * than a NaN-driven render glitch.
 *
 * Heights rise smoothly between zoom 15 and 16 (linear interpolate from 0 to
 * the real value). This matches the MapLibre official 3D-buildings example
 * and prevents a jarring "pop" the moment the layer becomes visible.
 *
 * Heights are expressed in meters above the ground. MapLibre composes
 * fill-extrusion with 3D terrain automatically, so buildings ride hillsides
 * correctly when the dark-terrain profile is active. The layer also renders
 * correctly under the globe projection (MapLibre ≥ 5).
 */
function buildPaint(dark: boolean): Record<string, unknown> {
  // User-spec colors: dark walls on dark basemaps, light walls on light.
  const color = dark ? "hsl(0, 0%, 22%)" : "hsl(0, 0%, 80%)";

  return {
    "fill-extrusion-color": color,
    "fill-extrusion-height": [
      "interpolate",
      ["linear"],
      ["zoom"],
      BUILDINGS_3D_MIN_ZOOM,
      0,
      BUILDINGS_3D_MIN_ZOOM + 1,
      ["coalesce", ["get", "render_height"], ["get", "height"], 0],
    ],
    "fill-extrusion-base": [
      "interpolate",
      ["linear"],
      ["zoom"],
      BUILDINGS_3D_MIN_ZOOM,
      0,
      BUILDINGS_3D_MIN_ZOOM + 1,
      ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
    ],
    "fill-extrusion-opacity": 0.6,
  };
}

/**
 * Add the 3D-buildings fill-extrusion layer to the map.
 *
 * Idempotent: if the layer already exists, this is a no-op. Safe to call on
 * every `style.load` — which is what `map.tsx` does to re-attach overlays
 * after the user swaps styles.
 *
 * Silently skips when:
 *   - The style has no vector source (raster styles like satellite / topo).
 *   - The vector source has no `building` source-layer (tileset doesn't carry
 *     buildings). MapLibre doesn't expose source-layer metadata synchronously,
 *     so we catch at addLayer time.
 */
export function addBuildings3DLayer(
  map: maplibregl.Map,
  options: { dark: boolean },
): void {
  if (map.getLayer(BUILDINGS_3D_LAYER_ID)) return;

  const source = findVectorSource(map);
  if (!source) return;

  // Insert before the first symbol (label) layer so map labels remain legible
  // on top of extruded geometry. Fallback to top-of-stack if no symbol layers.
  let beforeId: string | undefined;
  try {
    const layers = map.getStyle()?.layers ?? [];
    const firstSymbol = layers.find((l) => l.type === "symbol");
    beforeId = firstSymbol?.id;
  } catch {
    beforeId = undefined;
  }

  const layerSpec: maplibregl.LayerSpecification = {
    id: BUILDINGS_3D_LAYER_ID,
    type: "fill-extrusion",
    source,
    "source-layer": BUILDINGS_3D_SOURCE_LAYER,
    minzoom: BUILDINGS_3D_MIN_ZOOM,
    // Only render polygon building footprints — guards against rare point
    // features tagged as "building" in some vendor tilesets.
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: buildPaint(
      options.dark,
    ) as maplibregl.FillExtrusionLayerSpecification["paint"],
  };

  try {
    map.addLayer(layerSpec, beforeId);
  } catch {
    // Tileset lacks a "building" source-layer, or the style is in an
    // intermediate state. Fail silently — the map should still render.
  }
}

/**
 * Update the wall color when the theme flips without a full style swap.
 * Safe no-op if the layer isn't present.
 */
export function setBuildings3DTheme(map: maplibregl.Map, dark: boolean): void {
  if (!map.getLayer(BUILDINGS_3D_LAYER_ID)) return;
  try {
    const paint = buildPaint(dark);
    map.setPaintProperty(
      BUILDINGS_3D_LAYER_ID,
      "fill-extrusion-color",
      paint["fill-extrusion-color"],
    );
  } catch {
    // setPaintProperty can throw during style transitions — ignore.
  }
}

// Exposed for tests.
export const __internals = { buildPaint };

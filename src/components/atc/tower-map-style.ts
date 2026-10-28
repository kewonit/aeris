import type maplibregl from "maplibre-gl";

// CARTO's basemaps, retinted to sit quietly behind the towers: softer land,
// bluer water, quieter roads and labels. MapLibre paint can't read CSS variables, so the
// colours live here.

export const TOWER_MAP_STYLES = {
  light: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
} as const;

const TONES = {
  light: {
    land: "#f4f2ec",
    water: "#a9d2ee",
    park: "#d7eac8",
    road: "#ffffff",
    label: "#5d5c62",
    halo: "#f4f2ec",
  },
  dark: {
    land: "#1d1d1f",
    water: "#14212e",
    park: "#1e2620",
    road: "#333336",
    label: "#9a99a0",
    halo: "#1d1d1f",
  },
} as const;

export function tuneTowerMap(map: maplibregl.Map, dark: boolean): void {
  const tone = TONES[dark ? "dark" : "light"];
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    try {
      if (layer.type === "background") {
        map.setPaintProperty(id, "background-color", tone.land);
      } else if (layer.type === "fill" && /water/.test(id)) {
        map.setPaintProperty(id, "fill-color", tone.water);
      } else if (layer.type === "fill" && /park|landcover|wood|grass/.test(id)) {
        map.setPaintProperty(id, "fill-color", tone.park);
        map.setPaintProperty(id, "fill-opacity", dark ? 0.6 : 0.8);
      } else if (layer.type === "line" && /road|highway|tunnel|bridge/.test(id)) {
        map.setPaintProperty(id, "line-color", tone.road);
      } else if (layer.type === "symbol") {
        map.setPaintProperty(id, "text-color", tone.label);
        map.setPaintProperty(id, "text-halo-color", tone.halo);
      }
    } catch {
      // A layer without that paint property; leave CARTO's.
    }
  }
  drawIndiasBorders(map);
}

/**
 * Natural Earth's codes for the Kashmir, Aksai Chin and Arunachal lines that
 * the basemap draws as they stand on the ground.
 */
const KASHMIR = ["B00", "B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B45"];
const BORDER_LAYERS = ["boundary_country_outline", "boundary_country_inner", "boundary_state"];

/**
 * India as the Survey of India draws it: all of Jammu and Kashmir and Ladakh,
 * Aksai Chin and Arunachal Pradesh. The basemap's disputed lines come out and
 * /data/atc-borders.json (tools/atc-borders/build.py, from Natural Earth's India
 * point of view) goes
 * in, along with every other disputed line so nowhere else loses a border.
 */
function drawIndiasBorders(map: maplibregl.Map): void {
  const layers = map.getStyle().layers ?? [];
  const keep: maplibregl.ExpressionSpecification = [
    "all",
    ["!=", ["get", "disputed"], true],
    ["!", ["in", ["coalesce", ["get", "brk_a3"], ""], ["literal", KASHMIR]]],
  ];
  for (const layer of layers) {
    if (!BORDER_LAYERS.includes(layer.id) || !("filter" in layer)) continue;
    map.setFilter(
      layer.id,
      layer.filter ? ["all", layer.filter as maplibregl.ExpressionSpecification, keep] : keep,
    );
  }

  const labels = layers.find((layer) => layer.type === "symbol")?.id;
  map.addSource("india-borders", { type: "geojson", data: "/data/atc-borders.json" });
  const base = layers.find((layer) => layer.id === "boundary_country_inner");
  if (base?.type !== "line") return;
  map.addLayer(
    { id: "india-borders", type: "line", source: "india-borders", paint: base.paint, layout: base.layout },
    labels,
  );
}

import type maplibregl from "maplibre-gl";

/**
 * Runway and taxiway colours while following an aircraft. Dark styles draw
 * them in the background colour, which leaves an approach aimed at nothing.
 */
const AEROWAY_COLORS = {
  dark: { runway: "#9aa3b2", taxiway: "#4b5563" },
  light: { runway: "#4b5563", taxiway: "#9ca3af" },
} as const;
const AEROWAY_OPACITY = 0.9;
/**
 * Real widths, in metres. The style's widths stop growing at zoom 16, which
 * leaves a runway a thin line from close behind a landing aircraft.
 */
const AEROWAY_WIDTH_METERS = { runway: 45, taxiway: 23 } as const;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const TILE_SIZE = 512;
/** No thinner than this from afar, so a runway still shows. */
const MIN_AEROWAY_WIDTH_PX = 1.5;

/**
 * A line width that draws `meters` on the ground at every zoom: it doubles
 * with each zoom level, which an exponential interpolation of base 2 does.
 */
function groundWidth(meters: number, latitude: number) {
  const pixelsAt = (zoom: number) =>
    (meters * TILE_SIZE * 2 ** zoom) /
    (EARTH_CIRCUMFERENCE_METERS * Math.cos((latitude * Math.PI) / 180));
  return [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    8,
    MIN_AEROWAY_WIDTH_PX,
    12,
    Math.max(MIN_AEROWAY_WIDTH_PX, pixelsAt(12)),
    22,
    pixelsAt(22),
  ];
}
/** Runways show from this zoom, well before the approach. */
const RUNWAY_MIN_ZOOM = 8;

/**
 * Paints the style's runways and taxiways so they stand out, and returns a
 * function that puts the style's own paint back.
 */
export function highlightAeroways(
  map: maplibregl.Map,
  theme: "dark" | "light",
): () => void {
  const restores: (() => void)[] = [];
  const layers = map.getStyle()?.layers ?? [];
  const latitude = map.getCenter().lat;
  for (const layer of layers) {
    if (
      (layer.type !== "line" && layer.type !== "fill") ||
      !("source-layer" in layer) ||
      layer["source-layer"] !== "aeroway"
    ) {
      continue;
    }
    const kind = /runway/.test(layer.id) ? "runway" : "taxiway";
    const paint: [string, unknown][] = [
      [`${layer.type}-color`, AEROWAY_COLORS[theme][kind]],
      [`${layer.type}-opacity`, AEROWAY_OPACITY],
    ];
    if (layer.type === "line") {
      const width = groundWidth(AEROWAY_WIDTH_METERS[kind], latitude);
      paint.push(["line-width", width]);
    }
    for (const [property, value] of paint) {
      const previous = map.getPaintProperty(layer.id, property);
      map.setPaintProperty(layer.id, property, value);
      restores.push(() => map.setPaintProperty(layer.id, property, previous));
    }
    if (kind === "runway") {
      const { minzoom = 0, maxzoom = 24 } = layer;
      const from = Math.min(minzoom, RUNWAY_MIN_ZOOM);
      map.setLayerZoomRange(layer.id, from, maxzoom);
      restores.push(() => map.setLayerZoomRange(layer.id, minzoom, maxzoom));
    }
  }
  return () => {
    for (const restore of restores.reverse()) {
      try {
        restore();
      } catch {
        // The style changed underneath; its new layers have their own paint.
      }
    }
  };
}

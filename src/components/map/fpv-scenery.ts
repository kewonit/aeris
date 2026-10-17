import type maplibregl from "maplibre-gl";

/**
 * Camera pitch for level flight. 90° looks at the horizon; this looks a
 * little below it, so the ground ahead fills most of the view.
 */
export const FPV_LEVEL_PITCH = 83;
const MIN_FPV_PITCH = 80;
/** MapLibre allows more, but deck's camera stays aligned up to here. */
export const MAX_FPV_PITCH = 85;
/** How much of the nose's rise above level flight the view follows. */
const NOSE_FOLLOW = 0.4;
/** The nose sits this far above the flight path in level flight. */
const LEVEL_NOSE_UP_DEG = 3;

/**
 * The camera pitch for a nose this many degrees above the horizon: level
 * flight looks just below the horizon, and climbs and descents nod the view
 * by part of the nose's movement, within limits.
 */
export function fpvCameraPitch(noseUpDeg: number, onGround: boolean): number {
  if (onGround || !Number.isFinite(noseUpDeg)) return FPV_LEVEL_PITCH;
  const pitch =
    FPV_LEVEL_PITCH + NOSE_FOLLOW * (noseUpDeg - LEVEL_NOSE_UP_DEG);
  return Math.min(MAX_FPV_PITCH, Math.max(MIN_FPV_PITCH, pitch));
}

/**
 * Where the horizontal line through the camera crosses the screen, in
 * pixels from the top, for a camera with no padding.
 */
export function horizonScreenY(
  heightPx: number,
  verticalFovDeg: number,
  pitchDeg: number,
): number {
  const focal = heightPx / 2 / Math.tan((verticalFovDeg * Math.PI) / 360);
  return heightPx / 2 - focal * Math.tan(((90 - pitchDeg) * Math.PI) / 180);
}

/** Share of the view's height the haze covers. */
const HAZE_HEIGHT_SHARE = 0.12;

/**
 * A soft band of haze along the horizon. The map has no terrain, so
 * MapLibre's fog never reaches the ground and the map ends in a hard line
 * against the sky; the band hides that line and fades the far traffic
 * into it, as haze does.
 */
export function createHorizonHaze(map: maplibregl.Map, color: string) {
  const haze = document.createElement("div");
  haze.setAttribute("aria-hidden", "true");
  Object.assign(haze.style, {
    position: "absolute",
    left: "0",
    right: "0",
    top: "0",
    pointerEvents: "none",
    zIndex: "1",
    background: `linear-gradient(transparent, ${color} 50%, transparent)`,
    willChange: "transform",
  });
  map.getContainer().appendChild(haze);

  return {
    update(pitchDeg: number) {
      const height = map.getCanvas().clientHeight;
      const band = height * HAZE_HEIGHT_SHARE;
      const y = horizonScreenY(height, map.getVerticalFieldOfView(), pitchDeg);
      haze.style.height = `${band}px`;
      haze.style.transform = `translateY(${y - band / 2}px)`;
    },
    remove() {
      haze.remove();
    },
  };
}

/**
 * Runway and taxiway colours for the cockpit view. Dark styles draw them in
 * the background colour, which leaves an approach aimed at nothing.
 */
const AEROWAY_COLORS = {
  dark: { runway: "#9aa3b2", taxiway: "#4b5563" },
  light: { runway: "#4b5563", taxiway: "#9ca3af" },
} as const;
const AEROWAY_OPACITY = 0.9;
/**
 * Real widths, in metres. The style's widths stop growing at zoom 16, which
 * leaves a runway a thin line from the cockpit, many zoom levels further in.
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
/** Runways show from this zoom in the cockpit, well before the approach. */
const RUNWAY_MIN_ZOOM = 8;

/**
 * Paints the style's runways and taxiways so they stand out from the
 * cockpit, and returns a function that puts the style's own paint back.
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

import type { LayerSpecification } from "maplibre-gl";

// ── MapLibre style layer definitions for OpenAIP MVT airspace ──────
//
// Single vector source `openaip-airspace` is added in airspace-layer.tsx.
// This file exports the layer specs so the component stays lean and the
// palette/filters can be unit-tested.
//
// Palette is tuned for Aeris dark mode against CARTO dark base map.
// Strokes use rgba() with alpha to keep altitude-colored flights
// visually dominant.
// ────────────────────────────────────────────────────────────────────

export const AIRSPACE_SOURCE_ID = "openaip-airspace";

const SRC_AIRSPACES = "airspaces";
const SRC_OFFSET = "airspaces_border_offset";
const SRC_OFFSET_2X = "airspaces_border_offset_2x";

const CONTROLLED_TYPES = ["ctr", "tma", "cta"];
const RESTRICTED_TYPES = ["restricted", "danger", "prohibited", "tfr"];
const TMZ_RMZ_TYPES = ["tmz", "rmz"];
const ADIZ_TYPES = ["adiz"];
const CLASS_AE = ["a", "b", "c", "d", "e"];

/** All airspace `type` values rendered by at least one layer. */
export const AIRSPACE_RENDERED_TYPES = new Set<string>([
  ...CONTROLLED_TYPES,
  ...RESTRICTED_TYPES,
  ...TMZ_RMZ_TYPES,
  ...ADIZ_TYPES,
  "other", // class A–E polygons use type=other + icao_class match
]);

export const AIRSPACE_LAYERS: LayerSpecification[] = [
  // ── Restricted / Danger / Prohibited / TFR ───────────────────────
  {
    id: "airspace-restricted-fill",
    type: "fill",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_OFFSET,
    minzoom: 4,
    filter: ["match", ["get", "type"], RESTRICTED_TYPES, true, false],
    paint: {
      "fill-pattern": "airspace-diagonal-red",
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        0,
        7,
        0.18,
        12,
        0.22,
      ],
    },
  },
  {
    id: "airspace-restricted-line",
    type: "line",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_AIRSPACES,
    minzoom: 4,
    filter: ["match", ["get", "type"], RESTRICTED_TYPES, true, false],
    paint: {
      "line-color": "rgba(255, 90, 90, 0.95)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 10, 2],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 7, 1],
    },
  },
  // ── Controlled (CTR / TMA / CTA) ─────────────────────────────────
  {
    id: "airspace-controlled-fill",
    type: "fill",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_AIRSPACES,
    minzoom: 4,
    filter: ["match", ["get", "type"], CONTROLLED_TYPES, true, false],
    paint: {
      "fill-color": "rgba(255, 150, 180, 1)",
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        0,
        7,
        0.06,
        12,
        0.1,
      ],
    },
  },
  {
    id: "airspace-controlled-line",
    type: "line",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_AIRSPACES,
    minzoom: 4,
    filter: ["match", ["get", "type"], CONTROLLED_TYPES, true, false],
    paint: {
      "line-color": "rgba(255, 150, 180, 0.85)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 10, 1.8],
      "line-dasharray": [
        "case",
        ["==", ["get", "type"], "ctr"],
        ["literal", [3, 2]],
        ["literal", [1, 0]],
      ],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 7, 1],
    },
  },
  // ── Class A–E (type=other + icao_class match) ────────────────────
  {
    id: "airspace-class-line",
    type: "line",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_AIRSPACES,
    minzoom: 4,
    filter: [
      "all",
      ["==", ["get", "type"], "other"],
      ["match", ["get", "icao_class"], CLASS_AE, true, false],
    ],
    paint: {
      "line-color": [
        "match",
        ["get", "icao_class"],
        "a",
        "rgba(80, 200, 255, 0.9)",
        "b",
        "rgba(80, 200, 255, 0.9)",
        "c",
        "rgba(110, 220, 180, 0.9)",
        "d",
        "rgba(110, 220, 180, 0.9)",
        "e",
        "rgba(140, 170, 255, 0.75)",
        "rgba(140, 170, 255, 0.75)",
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 10, 1.6],
      "line-dasharray": [
        "match",
        ["get", "icao_class"],
        ["a", "b"],
        ["literal", [4, 2]],
        ["literal", [1, 0]],
      ],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 7, 1],
    },
  },
  // ── TMZ / RMZ ────────────────────────────────────────────────────
  {
    id: "airspace-tmz-rmz-line",
    type: "line",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_AIRSPACES,
    minzoom: 5,
    filter: ["match", ["get", "type"], TMZ_RMZ_TYPES, true, false],
    paint: {
      "line-color": "rgba(160, 200, 255, 0.7)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 12, 1.5],
      "line-dasharray": [2, 2],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 7, 1],
    },
  },
  // ── ADIZ ─────────────────────────────────────────────────────────
  {
    id: "airspace-adiz-fill",
    type: "fill",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_OFFSET_2X,
    minzoom: 3,
    filter: ["match", ["get", "type"], ADIZ_TYPES, true, false],
    paint: {
      "fill-pattern": "airspace-diagonal-purple",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 7, 0.15],
    },
  },
  {
    id: "airspace-adiz-line",
    type: "line",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_AIRSPACES,
    minzoom: 3,
    filter: ["match", ["get", "type"], ADIZ_TYPES, true, false],
    paint: {
      "line-color": "rgba(200, 130, 255, 0.9)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 10, 3],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 7, 1],
    },
  },
  // ── Labels (name only, z≥10) ─────────────────────────────────────
  {
    id: "airspace-label",
    type: "symbol",
    source: AIRSPACE_SOURCE_ID,
    "source-layer": SRC_AIRSPACES,
    minzoom: 10,
    filter: [
      "any",
      ["match", ["get", "type"], CONTROLLED_TYPES, true, false],
      ["match", ["get", "type"], RESTRICTED_TYPES, true, false],
      ["match", ["get", "type"], TMZ_RMZ_TYPES, true, false],
      ["match", ["get", "type"], ADIZ_TYPES, true, false],
      [
        "all",
        ["==", ["get", "type"], "other"],
        ["match", ["get", "icao_class"], CLASS_AE, true, false],
      ],
    ],
    layout: {
      "symbol-placement": "line",
      "text-field": ["coalesce", ["get", "name_label"], ["get", "name"]],
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 13, 12],
      "text-max-angle": 25,
      "text-letter-spacing": 0.02,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
    },
    paint: {
      "text-color": "#d8e4ff",
      "text-halo-color": "rgba(8, 12, 24, 0.85)",
      "text-halo-width": 1.5,
      "text-halo-blur": 0.5,
    },
  },
];

/** Layer ids that should respond to click / hover for the popup. */
export const AIRSPACE_INTERACTIVE_LAYER_IDS: string[] = [
  "airspace-restricted-fill",
  "airspace-controlled-fill",
  "airspace-adiz-fill",
];

// ── Bounds helper ──────────────────────────────────────────────────
//
// The airspace overlay is scoped to a circle around the active city
// so we don't pull down the whole world's vector tiles just to look
// at flights near one airport. MapLibre's vector source accepts a
// static `bounds` box (west, south, east, north) — tiles that don't
// intersect the box are never requested.
//
// We size the box at roughly 2× the flight fetch radius so the user
// can see airspace slightly beyond the furthest rendered aircraft
// without obvious clipping at the edge of the viewport.
// ────────────────────────────────────────────────────────────────────

/**
 * Multiplier applied to `city.radius` (degrees) to size the airspace
 * bounding box. 2× gives a comfortable margin around the flight
 * fetch circle while still skipping roughly 96% of the world's tiles.
 */
export const AIRSPACE_RADIUS_MULTIPLIER = 2;

/**
 * Effective half-width (degrees) for the airspace bounding box in FPV
 * mode. Flights are fetched at a 2° point-radius around the aircraft,
 * and we keep the same 2× multiplier → a 4° half-width box that
 * always encloses the visible traffic.
 */
export const FPV_AIRSPACE_RADIUS_DEG = 4;

/**
 * Grid snap applied to the FPV bbox center, so the source only
 * re-creates when the aircraft has flown about half a degree
 * (~30 NM / ~55 km at the equator). At typical cruise speeds that's
 * roughly one re-add every few minutes — cheap, and each cell's tiles
 * are already in the browser HTTP cache after the first visit.
 */
export const FPV_BOUNDS_SNAP_DEG = 0.5;

/** Web-Mercator clamps so MapLibre accepts the bounds. */
const MERCATOR_MAX_LAT = 85.051129;
const MERCATOR_MIN_LAT = -85.051129;
const LNG_MAX = 180;
const LNG_MIN = -180;

/**
 * Floor on `cos(latitude)` so longitude expansion never blows up near
 * the poles. cos(85°) ≈ 0.087, so 0.05 is a safe floor that only
 * kicks in well above Mercator's own cutoff.
 */
const COS_LAT_FLOOR = 0.05;

/** Readonly tuple: `[west, south, east, north]` in degrees. */
export type AirspaceBounds = readonly [number, number, number, number];

/**
 * Lightweight cancellation token shared by the overlay layers. Async
 * operations (sprite loading, RainViewer fetches) accept a token and
 * bail when `current` flips to `true`. The owning effect's cleanup
 * sets `current = true` so any in-flight work exits before the next
 * effect run starts a fresh swap.
 */
export type CancellationToken = { current: boolean };

type CityLike = {
  readonly coordinates: readonly [number, number];
  readonly radius: number;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute the bounding box used for the airspace vector source. Returns
 * `null` when no city is selected (overlay falls back to unrestricted
 * tiles in that case).
 *
 * Longitude span is scaled by `1 / cos(latitude)` so the box remains
 * roughly circular on the ground at higher latitudes. The result is
 * clamped to MapLibre's Mercator-safe range; callers don't need to do
 * any further validation before passing the tuple to `addSource`.
 */
export function computeAirspaceBounds(
  city: CityLike | null | undefined,
  multiplier: number = AIRSPACE_RADIUS_MULTIPLIER,
): AirspaceBounds | null {
  if (!city) return null;
  const [lng, lat] = city.coordinates;
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(city.radius) ||
    city.radius <= 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0
  ) {
    return null;
  }

  const latSpan = city.radius * multiplier;
  const cosLat = Math.max(
    Math.cos((clamp(lat, MERCATOR_MIN_LAT, MERCATOR_MAX_LAT) * Math.PI) / 180),
    COS_LAT_FLOOR,
  );
  const lngSpan = latSpan / cosLat;

  const west = clamp(lng - lngSpan, LNG_MIN, LNG_MAX);
  const east = clamp(lng + lngSpan, LNG_MIN, LNG_MAX);
  const south = clamp(lat - latSpan, MERCATOR_MIN_LAT, MERCATOR_MAX_LAT);
  const north = clamp(lat + latSpan, MERCATOR_MIN_LAT, MERCATOR_MAX_LAT);

  // Degenerate box (e.g. the clamp collapsed a pole-straddling box) —
  // fall back to no restriction rather than sending MapLibre a zero-area
  // rectangle that would hide the layer entirely.
  if (east <= west || north <= south) return null;

  return [west, south, east, north];
}

/** Stable string key for memo / effect deps. */
export function airspaceBoundsKey(bounds: AirspaceBounds | null): string {
  if (!bounds) return "none";
  // Round to ~1 m so tiny float drift doesn't trigger source re-adds.
  return bounds.map((v) => v.toFixed(5)).join(",");
}

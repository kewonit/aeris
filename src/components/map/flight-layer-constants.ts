import { type MapboxOverlay } from "@deck.gl/mapbox";
import { type PickingInfo } from "@deck.gl/core";
import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import type { MutableRefObject } from "react";

// ── Overlay type augmentation ──────────────────────────────────────────

export type DeckGLOverlay = MapboxOverlay & {
  pickObject?(opts: {
    x: number;
    y: number;
    radius: number;
  }): PickingInfo | null;
};

// ── Animation & rendering constants ────────────────────────────────────

export const DEFAULT_ANIM_DURATION_MS = 30_000;
export const MIN_ANIM_DURATION_MS = 8_000;
export const MAX_ANIM_DURATION_MS = 45_000;
export const TELEPORT_THRESHOLD = 0.3;
export const TRAIL_BELOW_AIRCRAFT_METERS = 40;
export const STARTUP_TRAIL_POLLS = 3;
export const STARTUP_TRAIL_STEP_SEC = 12;
export const TRACK_DAMPING = 0.18;
/** EMA alpha for MLAT position smoothing. MLAT accuracy (~100m) is 10×
 *  worse than ADS-B (~10m), so we blend toward the previous position to
 *  suppress jitter. 0.65 retains responsiveness while cutting noise. */
export const MLAT_POSITION_ALPHA = 0.65;
export const TRAIL_SMOOTHING_ITERATIONS = 3;
export const AIRCRAFT_PX_PER_UNIT = 0.3;
export const BASE_AIRCRAFT_SIZE = 22;
export const AIRCRAFT_MIN_PIXELS = 0.8;
export const AIRCRAFT_MAX_PIXELS = 18;
export const AIRCRAFT_PICK_RADIUS_PX = 14;
export const SELECTION_FADE_MS = 600;

// Globe/Mercator hard-switch: dots below this zoom, flights above.
export const GLOBE_SWITCH_ZOOM = 5.8;
export const GLOBE_FADE_ZOOM_FLOOR = GLOBE_SWITCH_ZOOM - 0.05;
export const GLOBE_FADE_ZOOM_CEIL = GLOBE_SWITCH_ZOOM + 0.05;
export const GLOBE_NATIVE_ZOOM_CEIL = GLOBE_SWITCH_ZOOM;

// LOD: switch between 3D ScenegraphLayers and 2D IconLayer.
// Uses hysteresis to avoid flickering when hovering near the boundary.
// Zoom in past LOD_3D_ZOOM_IN → 3D models; zoom out past LOD_3D_ZOOM_OUT → 2D icons.
export const LOD_3D_ZOOM_IN = 6.0;
export const LOD_3D_ZOOM_OUT = 5.0;

// GeoJSON globe dot layer timing
export const GEOJSON_THROTTLE_MS = 1500;
export const GEOJSON_DEBOUNCE_MS = 200;

// ── Shared types ───────────────────────────────────────────────────────

export type Snapshot = {
  lng: number;
  lat: number;
  alt: number;
  track: number;
};

export type ElevatedPoint = [number, number, number];

export type FlightLayerProps = {
  flights: FlightState[];
  trails: TrailEntry[];
  onClick: (info: PickingInfo<FlightState> | null) => void;
  selectedIcao24: string | null;
  showTrails: boolean;
  trailThickness: number;
  trailDistance: number;
  showShadows: boolean;
  showAltitudeColors: boolean;
  globeMode?: boolean;
  fpvIcao24?: string | null;
  fpvPositionRef?: MutableRefObject<{
    lng: number;
    lat: number;
    alt: number;
    track: number;
  } | null>;
};

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
export const TRAIL_SMOOTHING_ITERATIONS = 3;
export const AIRCRAFT_SCENEGRAPH_URL = "/models/airplane.glb";
export const AIRCRAFT_PX_PER_UNIT = 0.3;
export const BASE_AIRCRAFT_SIZE = 25;
export const AIRCRAFT_PICK_RADIUS_PX = 14;
export const SELECTION_FADE_MS = 600;

// Globe/Mercator hard-switch: dots below this zoom, flights above.
export const GLOBE_SWITCH_ZOOM = 5.8;
export const GLOBE_FADE_ZOOM_FLOOR = GLOBE_SWITCH_ZOOM - 0.05;
export const GLOBE_FADE_ZOOM_CEIL = GLOBE_SWITCH_ZOOM + 0.05;
export const GLOBE_NATIVE_ZOOM_CEIL = GLOBE_SWITCH_ZOOM;

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

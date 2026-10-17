import { type MapboxOverlay } from "@deck.gl/mapbox";
import { type PickingInfo } from "@deck.gl/core";
import type { FlightState } from "@/lib/opensky";
import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import type { TrailTrack } from "@/lib/trails/types";

// ── Overlay type augmentation ──────────────────────────────────────────

export type DeckGLOverlay = MapboxOverlay & {
  pickObject?(opts: {
    x: number;
    y: number;
    radius: number;
  }): PickingInfo | null;
};

// ── Animation & rendering constants ────────────────────────────────────

export const DEFAULT_ANIM_DURATION_MS = 4_500;
export const MIN_ANIM_DURATION_MS = 1_000;
export const MAX_ANIM_DURATION_MS = 30_000;
export const TELEPORT_THRESHOLD = 0.3;
export const TRACK_DAMPING = 0.18;
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
export const GEOJSON_DEBOUNCE_MS = 0;

// ── Shared types ───────────────────────────────────────────────────────

export type Snapshot = {
  lng: number;
  lat: number;
  alt: number;
  track: number;
};

export type FlightLayerProps = {
  flights: FlightState[];
  trails: TrailTrack[];
  onClick: (info: PickingInfo<FlightState> | null) => void;
  selectedIcao24: string | null;
  showTrails: boolean;
  trailThickness: number;
  trailMinutes: number;
  /** Aircraft flying above this many metres get no trail; null for none. */
  trailCeilingMeters: number | null;
  showShadows: boolean;
  showAltitudeColors: boolean;
  altitudeDisplayMode: AltitudeDisplayMode;
  globeMode?: boolean;
  fpvIcao24?: string | null;
};

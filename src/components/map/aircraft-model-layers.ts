// ── Aircraft Model Layers ──────────────────────────────────────────────
//
// Builds one ScenegraphLayer per model type from bucketised flights.
// This keeps flight-layers.tsx slim and model logic self-contained.
//
// Performance: Layers for ALL model keys are always created (even empty)
// so deck.gl never destroys/recreates them, avoiding shader recompilation.
// Empty layers use a stable EMPTY_DATA reference so deck.gl skips them.
// ────────────────────────────────────────────────────────────────────────

import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import type { FlightState } from "@/lib/opensky";
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
import {
  categorySizeMultiplier,
  tintAircraftColor,
} from "./aircraft-appearance";
import { type PickingInfo } from "@deck.gl/core";
import {
  AIRCRAFT_MIN_PIXELS,
  AIRCRAFT_MAX_PIXELS,
  BASE_AIRCRAFT_SIZE,
} from "./flight-layer-constants";
import {
  ALL_MODEL_KEYS,
  bucketFlightsByModel,
  modelNormScale,
  modelUrl,
} from "./aircraft-model-mapping";

// Stable empty array — same reference every frame so deck.gl skips buffer work
const EMPTY_DATA: FlightState[] = [];

// Track which models need to be loaded — once loaded, never unloaded.
// This prevents loading all 12 GLBs upfront; only models that appear in data get fetched.
const activatedModels = new Set<string>();

// ── Types ──────────────────────────────────────────────────────────────

export interface AircraftLayerParams {
  visibleFlights: FlightState[];
  layersVisible: boolean;
  globeFade: number;
  elevScale: number;
  altColors: boolean;
  defaultColor: [number, number, number, number];
  pitchByIcao: Map<string, number>;
  bankByIcao: Map<string, number>;
  handleHover: (info: PickingInfo<FlightState>) => void;
  handleClick: (info: PickingInfo<FlightState>) => void;
}

// ── Builder ────────────────────────────────────────────────────────────

/**
 * Returns an array of ScenegraphLayers — one per model key.
 * Layers for unused model types get `data: EMPTY_DATA` and `visible: false`,
 * which keeps the layer alive (no shader churn) with zero GPU cost.
 */
export function buildAircraftModelLayers(
  params: AircraftLayerParams,
): ScenegraphLayer<FlightState>[] {
  const {
    visibleFlights,
    layersVisible,
    globeFade,
    elevScale,
    altColors,
    defaultColor,
    pitchByIcao,
    bankByIcao,
    handleHover,
    handleClick,
  } = params;

  const buckets = bucketFlightsByModel(visibleFlights);

  return ALL_MODEL_KEYS.map((modelKey) => {
    const flights = buckets.get(modelKey) ?? EMPTY_DATA;
    const hasData = flights.length > 0;

    // Lazy-load: only fetch the GLB once a model type first appears in data.
    // After activation, keep it forever to avoid re-fetch/re-parse overhead.
    if (hasData) activatedModels.add(modelKey);
    const isActivated = activatedModels.has(modelKey);

    return new ScenegraphLayer<FlightState>({
      id: `flight-aircraft-${modelKey}`,
      visible: hasData && layersVisible,
      data: flights,
      opacity: globeFade,
      getPosition: (d) => [
        d.longitude!,
        d.latitude!,
        altitudeToElevation(d.baroAltitude) * elevScale,
      ],
      getOrientation: (d) => {
        const pitch = pitchByIcao.get(d.icao24) ?? 0;
        const bank = bankByIcao.get(d.icao24) ?? 0;
        // glTF models face +Z; roll=90 stands them upright on the map.
        // yaw = 180 - trueTrack converts CW-from-North heading to CCW yaw.
        const yaw = 180 - (Number.isFinite(d.trueTrack) ? d.trueTrack! : 0);
        return [pitch, yaw, 90 + bank];
      },
      getColor: (d) => {
        const base = altColors ? altitudeToColor(d.baroAltitude) : defaultColor;
        return tintAircraftColor(base, d.category);
      },
      scenegraph: isActivated ? modelUrl(modelKey) : undefined,
      loadOptions: isActivated ? { worker: false } : undefined,
      getScale: (d) => {
        const catScale = categorySizeMultiplier(d.category);
        const norm = modelNormScale(modelKey);
        const s = catScale * norm;
        return [s, s, s];
      },
      sizeScale: BASE_AIRCRAFT_SIZE,
      sizeMinPixels: AIRCRAFT_MIN_PIXELS,
      sizeMaxPixels: AIRCRAFT_MAX_PIXELS,
      _lighting: "flat",
      pickable: hasData,
      onHover: handleHover,
      onClick: handleClick,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
    });
  });
}

// ── Aircraft Model Layers ──────────────────────────────────────────────
//
// Builds one ScenegraphLayer per model type from bucketised flights.
// This keeps flight-layers.tsx slim and model logic self-contained.
//
// Performance strategy:
// 1. Bucket raw flights by model key (cached between polls via
//    bucketFlightsByModel — only recomputes when flightsRef changes).
// 2. Pass STABLE data arrays to each ScenegraphLayer (same reference
//    between animation frames) so deck.gl skips full attribute rebuild.
// 3. Use updateTriggers to selectively recompute only position & orientation
//    each frame. Color and scale are recomputed only on new data.
// 4. Layers are created for model keys that have active flights or were
//    recently active (within MODEL_DEACTIVATE_MS grace period). Truly
//    inactive models are omitted entirely to reduce overhead.
// ────────────────────────────────────────────────────────────────────────

import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import type { FlightState } from "@/lib/opensky";
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
import { tintAircraftColor, applySpecialTint } from "./aircraft-appearance";
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
  modelYawOffset,
} from "./aircraft-model-mapping";

// Stable empty array — same reference every frame so deck.gl skips buffer work
const EMPTY_DATA: FlightState[] = [];

// Track when each model type was last seen in flight data.
// Models not seen for MODEL_DEACTIVATE_MS are omitted from the layer array
// entirely, avoiding ScenegraphLayer constructor and deck.gl diffing overhead.
const modelLastUsed = new Map<string, number>();
const MODEL_DEACTIVATE_MS = 5_000; // 5 second grace period (covers 1 poll cycle)
const MODEL_LAST_USED_MAX = 50; // bound the Map to prevent unbounded growth

// ── Types ──────────────────────────────────────────────────────────────

export interface AircraftLayerParams {
  /** Raw flights (flightsRef.current) — stable between polls. Used for bucketing. */
  rawFlights: FlightState[];
  /** Interpolated flight map (icao24 → interpolated FlightState). Updated every frame. */
  interpolatedMap: Map<string, FlightState>;
  /** Animation frame counter — increments every rAF. Drives position/orientation updates. */
  frameCounter: number;
  /** Data version — increments on new poll data. Triggers color/scale recomputation. */
  dataVersion: number;
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
 *
 * Key optimization: `data` uses the CACHED bucket arrays (stable reference
 * between animation frames). Accessors look up interpolated positions from
 * the `interpolatedMap`. `updateTriggers` selectively recompute:
 *   - getPosition / getOrientation: every frame (via frameCounter)
 *   - getColor: only on new data (via dataVersion)
 *
 * This eliminates per-frame color/scale attribute recomputation for all
 * 14 layers and massively reduces GC pressure from array allocations.
 */
export function buildAircraftModelLayers(
  params: AircraftLayerParams,
): ScenegraphLayer<FlightState>[] {
  const {
    rawFlights,
    interpolatedMap,
    frameCounter,
    dataVersion,
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

  // Cached bucketing — only recomputes when rawFlights reference changes
  const buckets = bucketFlightsByModel(rawFlights);
  const now = performance.now();

  // Only build layers for models that have data or are within the grace
  // period. Truly inactive models (no data AND expired) are skipped entirely,
  // avoiding ScenegraphLayer constructor + deck.gl diffing overhead.
  // Evict stale entries to bound memory growth over long sessions
  if (modelLastUsed.size > MODEL_LAST_USED_MAX) {
    for (const [k, ts] of modelLastUsed) {
      if (now - ts > MODEL_DEACTIVATE_MS) modelLastUsed.delete(k);
    }
  }

  return ALL_MODEL_KEYS.filter((key) => {
    const hasData = (buckets.get(key)?.length ?? 0) > 0;
    if (hasData) {
      modelLastUsed.set(key, now);
      return true;
    }
    return now - (modelLastUsed.get(key) ?? 0) < MODEL_DEACTIVATE_MS;
  }).map((modelKey) => {
    const flights = buckets.get(modelKey) ?? EMPTY_DATA;
    const hasData = flights.length > 0;

    // Pre-compute the yaw offset once per layer (not per-flight per-frame)
    const yawOff = modelYawOffset(modelKey);
    const normScale = modelNormScale(modelKey);

    return new ScenegraphLayer<FlightState>({
      id: `flight-aircraft-${modelKey}`,
      visible: hasData && layersVisible,
      data: flights,
      opacity: globeFade,
      getPosition: (d) => {
        const interp = interpolatedMap.get(d.icao24);
        const src = interp ?? d;
        return [
          src.longitude ?? 0,
          src.latitude ?? 0,
          altitudeToElevation(src.baroAltitude) * elevScale,
        ];
      },
      getOrientation: (d) => {
        const interp = interpolatedMap.get(d.icao24);
        const src = interp ?? d;
        const pitch = pitchByIcao.get(d.icao24) ?? 0;
        const bank = bankByIcao.get(d.icao24) ?? 0;
        const yaw =
          yawOff - (Number.isFinite(src.trueTrack) ? src.trueTrack! : 0);
        return [pitch, yaw, 90 + bank];
      },
      getColor: (d) => {
        const base = altColors ? altitudeToColor(d.baroAltitude) : defaultColor;
        const catColor = tintAircraftColor(base, d.category);
        return applySpecialTint(catColor, d.dbFlags, d.emergencyStatus);
      },
      scenegraph: modelUrl(modelKey),
      getScale: () => {
        return [normScale, normScale, normScale];
      },
      sizeScale: BASE_AIRCRAFT_SIZE,
      updateTriggers: {
        getPosition: [frameCounter, elevScale],
        getOrientation: frameCounter,
        getColor: [dataVersion, altColors],
      },
      sizeMinPixels: AIRCRAFT_MIN_PIXELS,
      sizeMaxPixels: AIRCRAFT_MAX_PIXELS,
      _lighting: "pbr",
      pickable: hasData,
      onHover: handleHover,
      onClick: handleClick,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
    });
  });
}

// ── Aircraft Model Layers ──────────────────────────────────────────────
//
// Builds one ScenegraphLayer per model type from bucketised flights.
// This keeps flight-layers.tsx slim and model logic self-contained.
//
// Performance strategy:
// 1. Bucket raw flights by model key (cached between polls via
//    bucketFlightsByModel - only recomputes when flightsRef changes).
// 2. Pass STABLE data arrays to each ScenegraphLayer (same reference
//    between animation frames) so deck.gl skips full attribute rebuild.
// 3. Use updateTriggers to selectively recompute only position & orientation
//    each frame. Color and scale are recomputed only on new data.
// 4. Layers are created for model keys that have active flights or were
//    recently active (within MODEL_DEACTIVATE_MS grace period). Truly
//    inactive models are omitted entirely to reduce overhead.
// ────────────────────────────────────────────────────────────────────────

import {
  ScenegraphLayer,
  type ScenegraphLayerProps,
} from "@deck.gl/mesh-layers";
import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import type { FlightState } from "@/lib/opensky";
import { altitudeToColor } from "@/lib/flight-utils";
import { aircraftColor } from "./aircraft-appearance";
import { type PickingInfo } from "@deck.gl/core";
import {
  type AircraftModelKey,
  ALL_MODEL_KEYS,
  bucketFlightsByModel,
  modelNoseTurn,
  modelUrl,
} from "./aircraft-model-mapping";
import {
  type AircraftScreenSize,
  recordModelTailShare,
} from "./aircraft-size";
import { aircraftElevationMeters } from "./altitude-projection";

// Stable empty array - same reference every frame so deck.gl skips buffer work
const EMPTY_DATA: FlightState[] = [];

// Track when each model type was last seen in flight data.
// Models not seen for MODEL_DEACTIVATE_MS are omitted from the layer array
// entirely, avoiding ScenegraphLayer constructor and deck.gl diffing overhead.
const modelLastUsed = new Map<string, number>();
const MODEL_DEACTIVATE_MS = 15_000; // 15 second grace period (covers 3+ poll cycles)
const MODEL_LAST_USED_MAX = 50; // bound the Map to prevent unbounded growth

/** Turns the glTF Y-up models upright in deck's Z-up world. */
const BASE_MODEL_ROLL = 90;
/** Yaw that points a normalised model, nose along +X, due north. */
const NORTH_YAW = 90;

/** Pixel size used until a flight's size has been measured this frame. */
const FALLBACK_FOOTPRINT_PX = 20;

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

type SceneNode = {
  getBounds(): number[][] | null;
  setMatrix(matrix: number[]): void;
};

/** A model's spans along X and Z, as shares of its footprint. */
export type ModelFootprint = { x: number; z: number };

const normalizedScenes = new WeakMap<SceneNode, ModelFootprint | null>();

/**
 * Centres a model on its origin, turns it about its up axis so its nose
 * points along +X, and scales its footprint, the larger of its wingspan and
 * length, to one unit. The source meshes are off-centre, in unrelated units
 * and face different ways, so without this a model sits beside its
 * position, its size depends on how the file was authored, and pitch and
 * bank tilt it about the wrong axes.
 */
export function normalizeScene(
  scene: SceneNode,
  noseTurnDegrees = 0,
): ModelFootprint | null {
  const known = normalizedScenes.get(scene);
  if (known !== undefined) return known;

  scene.setMatrix(IDENTITY_MATRIX);
  const bounds = scene.getBounds();
  let footprint: ModelFootprint | null = null;
  if (bounds) {
    const [min, max] = bounds;
    const [cx, cy, cz] = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
    // Y is up in glTF, so X and Z span the footprint.
    const spanX = max[0] - min[0];
    const spanZ = max[2] - min[2];
    const extent = Math.max(spanX, spanZ);
    const scale = extent > 0 ? 1 / extent : 1;
    // Turns are whole quarter turns, so round away floating-point dust.
    const radians = (noseTurnDegrees * Math.PI) / 180;
    const cos = Math.round(Math.cos(radians) * 1e9) / 1e9;
    const sin = Math.round(Math.sin(radians) * 1e9) / 1e9;
    // Columns of scale · turn about Y · move the centre to the origin.
    scene.setMatrix([
      scale * cos, 0, -scale * sin, 0,
      0, scale, 0, 0,
      scale * sin, 0, scale * cos, 0,
      -scale * (cos * cx + sin * cz),
      -scale * cy,
      -scale * (cos * cz - sin * cx),
      1,
    ]);
    footprint = {
      x: (Math.abs(cos) * spanX + Math.abs(sin) * spanZ) * scale,
      z: (Math.abs(sin) * spanX + Math.abs(cos) * spanZ) * scale,
    };
  }
  normalizedScenes.set(scene, footprint);
  return footprint;
}

/**
 * How far behind its centre a model's tail sits, as a share of its
 * footprint. Every normalised model has its fuselage along X. Aiming just
 * inside the tail keeps the trail's end under the model.
 */
export function modelTailShareFor(footprint: ModelFootprint): number {
  return (0.9 * footprint.x) / 2;
}

/**
 * deck's [pitch, yaw, roll] for a normalised model. deck turns by roll,
 * then pitch, then yaw, each about a fixed axis; with the nose along +X
 * that is heading, then pitch, then bank in the aircraft's own frame.
 * Negative pitch raises the nose and positive bank lowers the right wing.
 */
export function aircraftOrientation(
  track: number,
  pitch: number,
  bank: number,
): [number, number, number] {
  return [pitch, NORTH_YAW - track, BASE_MODEL_ROLL + bank];
}

type GetScene = NonNullable<ScenegraphLayerProps<FlightState>["getScene"]>;

const sceneLoaders = new Map<AircraftModelKey, GetScene>();

/** deck's default scene choice, normalised, recording where its tail is. */
function sceneLoaderFor(key: AircraftModelKey): GetScene {
  let loader = sceneLoaders.get(key);
  if (!loader) {
    loader = (scenegraph) => {
      // While the model is still loading deck passes null, and expects it
      // back untouched; anything else is logged as an invalid scenegraph.
      if (!scenegraph?.scenes) return scenegraph;
      const scene =
        typeof scenegraph.scene === "object"
          ? scenegraph.scene
          : scenegraph.scenes[scenegraph.scene || 0];
      const footprint = scene
        ? normalizeScene(scene, modelNoseTurn(key))
        : null;
      if (footprint) {
        recordModelTailShare(key, modelTailShareFor(footprint));
      }
      return scene;
    };
    sceneLoaders.set(key, loader);
  }
  return loader;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface AircraftLayerParams {
  /** Raw flights (flightsRef.current) - stable between polls. Used for bucketing. */
  rawFlights: FlightState[];
  /** Interpolated flight map (icao24 → interpolated FlightState). Updated every frame. */
  interpolatedMap: Map<string, FlightState>;
  /** Animation frame counter - increments every rAF. Drives position/orientation updates. */
  frameCounter: number;
  /** Data version - increments on new poll data. Triggers color/scale recomputation. */
  dataVersion: number;
  layersVisible: boolean;
  globeFade: number;
  /** Each aircraft's drawn size this frame, keyed by icao24. */
  aircraftSizes: Map<string, AircraftScreenSize>;
  altitudeDisplayMode: AltitudeDisplayMode;
  altColors: boolean;
  defaultColor: [number, number, number, number];
  pitchByIcao: Map<string, number>;
  bankByIcao: Map<string, number>;
  handleHover: (info: PickingInfo<FlightState>) => void;
  handleClick: (info: PickingInfo<FlightState>) => void;
}

// ── Builder ────────────────────────────────────────────────────────────

/**
 * Returns an array of ScenegraphLayers - one per model key.
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
    aircraftSizes,
    altitudeDisplayMode,
    altColors,
    defaultColor,
    pitchByIcao,
    bankByIcao,
    handleHover,
    handleClick,
  } = params;

  // Cached bucketing - only recomputes when rawFlights reference changes
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

    return new ScenegraphLayer<FlightState>({
      id: `flight-aircraft-${modelKey}`,
      visible: hasData && layersVisible,
      data: flights,
      opacity: globeFade,
      getPosition: (d) => {
        const src = interpolatedMap.get(d.icao24) ?? d;
        return [
          src.longitude ?? 0,
          src.latitude ?? 0,
          aircraftElevationMeters(src.baroAltitude, altitudeDisplayMode),
        ];
      },
      getOrientation: (d) => {
        const src = interpolatedMap.get(d.icao24) ?? d;
        return aircraftOrientation(
          Number.isFinite(src.trueTrack) ? src.trueTrack! : 0,
          pitchByIcao.get(d.icao24) ?? 0,
          bankByIcao.get(d.icao24) ?? 0,
        );
      },
      getColor: (d) => {
        const base = altColors ? altitudeToColor(d.baroAltitude) : defaultColor;
        return aircraftColor(base, d);
      },
      scenegraph: modelUrl(modelKey),
      getScene: sceneLoaderFor(modelKey),
      // The normalised model is one unit wide and one unit is one pixel, so
      // the scale is the drawn width, less any perspective enlargement.
      getScale: (d) => {
        const size = aircraftSizes.get(d.icao24);
        const pixels = size
          ? size.footprintPx / size.magnification
          : FALLBACK_FOOTPRINT_PX;
        return [pixels, pixels, pixels];
      },
      sizeScale: 1,
      sizeMinPixels: 1,
      sizeMaxPixels: 1,
      updateTriggers: {
        getPosition: [frameCounter, altitudeDisplayMode],
        getOrientation: frameCounter,
        getScale: frameCounter,
        getColor: [dataVersion, altColors],
      },
      _lighting: "pbr",
      pickable: hasData,
      onHover: handleHover,
      onClick: handleClick,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
    });
  });
}

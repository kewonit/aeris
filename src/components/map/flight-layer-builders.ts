import { IconLayer, PathLayer } from "@deck.gl/layers";
import { altitudeToElevation } from "@/lib/flight-utils";
import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import type { ElevatedPoint } from "./flight-layer-constants";
import { SELECTION_FADE_MS } from "./flight-layer-constants";
import {
  PULSE_PERIOD_MS,
  HALO_MAPPING,
  RING_MAPPING,
} from "./aircraft-appearance";
import {
  buildStartupFallbackTrail,
  buildVisibleTrailPoints,
  buildTrailBasePath,
  pinIncrementalBasePath,
  trailBasePathCacheKey,
} from "./trail-base-path";
import { buildTrailConnector } from "./trail-connector";
import { projectTrailElevationMeters } from "./altitude-projection";
import { smoothStep } from "./flight-math";
import { getAircraftModelCalibration } from "./aircraft-model-calibration";
import { resolveModelKey } from "./aircraft-model-mapping";
import {
  buildConnectorGradientColors,
  buildTrailRenderSegments,
  trailAltitudeToColor,
  trimTrailBodyForConnector,
  type TrailRenderSegment,
} from "./trail-render-segments";
import { toPathLayerPoints } from "./trail-render-adapter";

// ── Slope limiter (post-elevation-exaggeration) ────────────────────────

/**
 * Maximum elevation-change-per-degree ratio for rendered trail paths.
 * One degree of latitude ≈ 111 km.  A ratio of 80 000 means
 * max visual slope ≈ 80 km rise per 111 km horizontal ≈ ~36°.
 */
const MAX_ELEV_GRADIENT = 80_000;
export { buildConnectorGradientColors, trailAltitudeToColor };

/**
 * Caps the vertical gradient of an already-elevation-exaggerated trail
 * so that steep climbs/descents don't look like near-vertical walls.
 * Forward-backward averaging preserves the trail endpoints while
 * preventing any single segment from exceeding MAX_ELEV_GRADIENT.
 */
function limitTrailSlope(
  pts: [number, number, number][],
): [number, number, number][] {
  if (pts.length < 2) return pts;

  const n = pts.length;

  const fwd = pts.map((p) => p[2]);
  for (let i = 1; i < n; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const dH = Math.sqrt(dx * dx + dy * dy);
    const maxDz = Math.max(dH * MAX_ELEV_GRADIENT, 30);
    const dz = fwd[i] - fwd[i - 1];
    if (Math.abs(dz) > maxDz) {
      fwd[i] = fwd[i - 1] + Math.sign(dz) * maxDz;
    }
  }

  const bwd = pts.map((p) => p[2]);
  for (let i = n - 2; i >= 0; i--) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const dH = Math.sqrt(dx * dx + dy * dy);
    const maxDz = Math.max(dH * MAX_ELEV_GRADIENT, 30);
    const dz = bwd[i] - bwd[i + 1];
    if (Math.abs(dz) > maxDz) {
      bwd[i] = bwd[i + 1] + Math.sign(dz) * maxDz;
    }
  }

  return pts.map((p, i) => {
    // Preserve endpoints so trail connects to aircraft and origin
    if (i === 0 || i === n - 1) return p;
    const avg = (fwd[i] + bwd[i]) / 2;
    return [p[0], p[1], Math.max(0, Number.isFinite(avg) ? avg : p[2])];
  });
}

// ── Trail layer builder ────────────────────────────────────────────────

export interface TrailLayerParams {
  interpolated: FlightState[];
  interpolatedMap: Map<string, FlightState>;
  currentTrails: TrailEntry[];
  /** Pre-built trail-by-icao24 Map — passed from parent to avoid per-frame allocation */
  trailMap: Map<string, TrailEntry>;
  trailDistance: number;
  trailThickness: number;
  altColors: boolean;
  altitudeDisplayMode: AltitudeDisplayMode;
  defaultColor: [number, number, number, number];
  elapsed: number;
  /** Visual frame counter — throttled counter that only increments on rendered frames */
  visualFrame: number;
  globeFade: number;
  currentZoom: number;
  /** Pre-computed zoom-dependent elevation scale — avoids recomputing per accessor call */
  elevScale: number;
  visible?: boolean;
  /** Persistent cache for expensive base path computations across frames */
  trailBasePathCache?: Map<string, { key: string; basePath: ElevatedPoint[] }>;
  /** Persistent cache for slope-limited trail paths across frames */
  trailPathCache?: Map<
    string,
    { key: string; result: [number, number, number][] }
  >;
  /** Persistent cache for trail colors across frames */
  trailColorCache?: Map<
    string,
    { key: string; result: [number, number, number, number][] }
  >;
  /** Reusable containers — cleared and reused each frame to avoid per-frame allocations */
  handledIdsSet?: Set<string>;
  visibleTrailCacheMap?: Map<string, ElevatedPoint[]>;
  activeIcaosSet?: Set<string>;
}

interface TrailConnectorSegment {
  icao24: string;
  path: ElevatedPoint[];
}

export function buildTrailLayers(params: TrailLayerParams) {
  const {
    interpolated,
    interpolatedMap,
    currentTrails,
    trailMap,
    trailDistance,
    trailThickness,
    altColors,
    altitudeDisplayMode,
    defaultColor,
    globeFade,
    elevScale,
    visible = true,
    trailBasePathCache,
    trailPathCache,
    handledIdsSet,
    visibleTrailCacheMap,
    activeIcaosSet,
  } = params;

  const handledIds = handledIdsSet ?? new Set<string>();
  handledIds.clear();
  const trailData: TrailEntry[] = [];

  const visibleTrailCache =
    visibleTrailCacheMap ?? new Map<string, ElevatedPoint[]>();
  visibleTrailCache.clear();
  const renderBodyPointCache = new Map<string, ElevatedPoint[]>();
  const activeIcaos = trailBasePathCache
    ? (activeIcaosSet ?? new Set<string>())
    : null;
  activeIcaos?.clear();

  const getVisibleTrailPoints = (
    trail: TrailEntry,
    animFlight: FlightState | undefined,
  ): ElevatedPoint[] => {
    const cached = visibleTrailCache.get(trail.icao24);
    if (cached) return cached;

    // Try to use cached base path (expensive smoothing/densification)
    let basePath: ElevatedPoint[] | undefined;
    if (trailBasePathCache) {
      const key = trailBasePathCacheKey(trail, trailDistance);
      const entry = trailBasePathCache.get(trail.icao24);
      if (entry && entry.key === key) {
        basePath = entry.basePath;
      } else {
        const freshBasePath = buildTrailBasePath(trail, trailDistance);

        // Pin stable points from the previous cache so that already-
        // plotted trail positions never visually shift when new GPS
        // data extends the trail.  fullHistory trails skip pinning
        // because they are loaded once and don't grow incrementally.
        basePath =
          entry && !trail.fullHistory
            ? pinIncrementalBasePath(entry.basePath, freshBasePath)
            : freshBasePath;

        trailBasePathCache.set(trail.icao24, { key, basePath });
      }
      activeIcaos?.add(trail.icao24);
    }

    const computed = buildVisibleTrailPoints(
      trail,
      animFlight,
      trailDistance,
      basePath,
    );
    visibleTrailCache.set(trail.icao24, computed);
    return computed;
  };

  const getRenderableBodyPoints = (
    trail: TrailEntry,
    aircraft: FlightState | undefined,
  ): ElevatedPoint[] => {
    const cached = renderBodyPointCache.get(trail.icao24);
    if (cached) return cached;

    const visiblePoints = getVisibleTrailPoints(trail, aircraft);
    if (!aircraft) {
      renderBodyPointCache.set(trail.icao24, visiblePoints);
      return visiblePoints;
    }

    const calibration = getAircraftModelCalibration(
      resolveModelKey(aircraft.category, aircraft.typeCode),
    );
    const trimmed = trimTrailBodyForConnector(
      visiblePoints,
      calibration.tailAnchorMeters,
    );
    renderBodyPointCache.set(trail.icao24, trimmed);
    return trimmed;
  };

  for (const f of interpolated) {
    if (f.longitude == null || f.latitude == null) continue;
    const existing = trailMap.get(f.icao24);
    handledIds.add(f.icao24);
    activeIcaos?.add(f.icao24);
    if (existing && existing.path.length >= 2) {
      trailData.push(existing);
      continue;
    }
    const startupPath = buildStartupFallbackTrail(f);
    trailData.push({
      icao24: f.icao24,
      path: startupPath,
      altitudes: startupPath.map(
        () => existing?.baroAltitude ?? f.baroAltitude,
      ),
      timestamps: startupPath.map(() => 0),
      baroAltitude: existing?.baroAltitude ?? f.baroAltitude,
    });
  }

  for (const d of currentTrails) {
    if (!handledIds.has(d.icao24)) {
      trailData.push(d);
      activeIcaos?.add(d.icao24);
    }
  }

  // Sweep stale entries from persistent caches
  if (trailBasePathCache && activeIcaos) {
    for (const icao of trailBasePathCache.keys()) {
      if (!activeIcaos.has(icao)) {
        trailBasePathCache.delete(icao);
      }
    }
  }
  if (trailPathCache && activeIcaos) {
    for (const icao of trailPathCache.keys()) {
      if (!activeIcaos.has(icao)) trailPathCache.delete(icao);
    }
  }

  const connectorData = trailData.flatMap((trail) => {
    const aircraft = interpolatedMap.get(trail.icao24);
    const visiblePoints = getRenderableBodyPoints(trail, aircraft);
    const connector = buildTrailConnector(
      visiblePoints,
      aircraft,
      aircraft
        ? {
            tailGapMeters: getAircraftModelCalibration(
              resolveModelKey(aircraft.category, aircraft.typeCode),
            ).tailAnchorMeters,
          }
        : undefined,
    );
    return connector
      ? [
          {
            icao24: trail.icao24,
            path: connector,
          } satisfies TrailConnectorSegment,
        ]
      : [];
  });

  const trailBodySegments = trailData.flatMap((trail) => {
    const animFlight = interpolatedMap.get(trail.icao24);
    const pathKey = `${trailBasePathCacheKey(trail, trailDistance)}_${altitudeDisplayMode}_${elevScale.toFixed(3)}`;

    if (trailPathCache) {
      const cached = trailPathCache.get(trail.icao24);
      if (cached && cached.key === pathKey) {
        return buildTrailRenderSegments({
          icao24: trail.icao24,
          points: cached.result,
          kind: "body",
          altColors,
          defaultColor,
        });
      }
    }

    const raw = toPathLayerPoints(
      getRenderableBodyPoints(trail, animFlight),
    ).map(
      (p) =>
        [
          p[0],
          p[1],
          Math.max(
            0,
            projectTrailElevationMeters(p[2], altitudeDisplayMode) * elevScale,
          ),
        ] as [number, number, number],
    );
    const clean = raw.filter(
      (p) =>
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Number.isFinite(p[2]),
    );
    const result = limitTrailSlope(clean);
    trailPathCache?.set(trail.icao24, { key: pathKey, result });

    return buildTrailRenderSegments({
      icao24: trail.icao24,
      points: result,
      kind: "body",
      altColors,
      defaultColor,
    });
  });

  const trailBodyLayer = new PathLayer<TrailRenderSegment>({
    id: "flight-trails",
    pickable: false,
    visible,
    data: trailBodySegments,
    opacity: globeFade,
    getPath: (d) => d.path,
    getColor: (d) => d.color,
    getWidth: trailThickness * 1.15,
    widthUnits: "pixels",
    widthMinPixels: Math.max(1.5, trailThickness * 0.9),
    widthMaxPixels: Math.max(3, trailThickness * 2.4),
    wrapLongitude: true,
    billboard: true,
    capRounded: true,
    jointRounded: true,
  });

  const connectorSegments = connectorData.flatMap((segment) => {
    const raw = toPathLayerPoints(segment.path).map(
      (p) =>
        [
          p[0],
          p[1],
          Math.max(
            0,
            projectTrailElevationMeters(p[2], altitudeDisplayMode) * elevScale,
          ),
        ] as [number, number, number],
    );
    const clean = raw.filter(
      (p) =>
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Number.isFinite(p[2]),
    );

    return buildTrailRenderSegments({
      icao24: segment.icao24,
      points: limitTrailSlope(clean),
      kind: "connector",
      altColors,
      defaultColor,
    });
  });

  const connectorLayer = new PathLayer<TrailRenderSegment>({
    id: "flight-trail-connectors",
    pickable: false,
    visible,
    data: connectorSegments,
    opacity: globeFade,
    getPath: (d) => d.path,
    getColor: (d) => d.color,
    getWidth: trailThickness,
    widthUnits: "pixels",
    widthMinPixels: Math.max(1, trailThickness * 0.6),
    widthMaxPixels: Math.max(2, trailThickness * 1.8),
    wrapLongitude: true,
    billboard: true,
    capRounded: true,
    jointRounded: true,
  });

  return [trailBodyLayer, connectorLayer];
}

// ── Selection pulse layer builder ──────────────────────────────────────

export interface SelectionPulseParams {
  selectionChangeTime: number;
  selectedId: string | null;
  prevId: string | null;
  interpolated: FlightState[];
  interpolatedMap: Map<string, FlightState>;
  elapsed: number;
  globeFade: number;
  currentZoom: number;
  /** Pre-computed zoom-dependent elevation scale */
  elevScale: number;
  altitudeDisplayMode: AltitudeDisplayMode;
  haloUrl: string;
  ringUrl: string;
  layersVisible?: boolean;
}

export interface SelectionPulseResult {
  layers: IconLayer[];
  shouldClearPrev: boolean;
}

// Dummy position used for invisible layers to keep deck.gl layer state alive
const EMPTY_PULSE_DATA: { position: [number, number, number] }[] = [];

export function buildSelectionPulseLayers(
  params: SelectionPulseParams,
): SelectionPulseResult {
  const {
    selectionChangeTime,
    selectedId,
    prevId,
    interpolatedMap,
    elapsed,
    globeFade,
    elevScale,
    altitudeDisplayMode,
    haloUrl,
    ringUrl,
    layersVisible = true,
  } = params;

  const layers: IconLayer[] = [];
  const fadeElapsed = performance.now() - selectionChangeTime;
  const fadeT = Math.min(fadeElapsed / SELECTION_FADE_MS, 1);
  const fadeIn = smoothStep(fadeT);
  const fadeOut = 1 - fadeIn;

  let shouldClearPrev = false;
  if (!prevId || prevId === selectedId || fadeOut <= 0.01) {
    if (fadeT >= 1) shouldClearPrev = true;
  }

  // Build stable layers for both "sel" and "prev" prefixes.
  // Always emit all 4 IDs; use `visible` to toggle rather than omitting layers.
  const prefixes = ["sel", "prev"] as const;
  for (const prefix of prefixes) {
    const isSelected = prefix === "sel";
    const targetId = isSelected ? selectedId : prevId;
    const op = isSelected ? fadeIn : fadeOut;

    const flight = targetId ? interpolatedMap.get(targetId) : undefined;
    const hasPosition =
      flight && flight.longitude != null && flight.latitude != null;

    const active = layersVisible && !!targetId && hasPosition && op > 0.01;
    const elevation =
      flight && flight.baroAltitude != null
        ? altitudeToElevation(flight.baroAltitude, altitudeDisplayMode) *
          elevScale
        : 0;
    const pos: [number, number, number] =
      flight && flight.longitude != null && flight.latitude != null
        ? [flight.longitude, flight.latitude, elevation]
        : [0, 0, 0];
    const data = active ? [{ position: pos }] : EMPTY_PULSE_DATA;

    const breathT = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    // Pure sine wave for a gentle, smooth breathing effect.
    // Previous double-smoothStep created sharp snap transitions.
    const breath = Math.sin(breathT * Math.PI * 2);

    // Subtle background glow — barely visible, provides soft ambient light.
    // At 86px with 40% clear center: clear zone = 17px radius, well outside
    // the largest aircraft icon (~12px radius).
    const haloSize = 86 + 1.5 * breath;
    const haloAlpha = Math.round((10 + 3 * breath) * op);

    layers.push(
      new IconLayer({
        id: `${prefix}-halo`,
        pickable: false,
        visible: active && haloAlpha > 0,
        data,
        opacity: globeFade,
        getPosition: (d: { position: [number, number, number] }) => d.position,
        getIcon: () => "halo",
        getSize: haloSize,
        getColor: [70, 160, 240, haloAlpha],
        iconAtlas: haloUrl,
        iconMapping: HALO_MAPPING,
        billboard: true,
        sizeUnits: "pixels",
        sizeScale: 1,
      }),
    );

    // Single clean ring that gently breathes in size and opacity.
    // No expansion animation — just a calm, static indicator.
    // In sync with halo (no phase offset) for a unified pulse.
    // At 68px, ring inner edge = 0.57 * 34 = 19px — clears the aircraft.
    const ringSize = 68 + 1.5 * breath;
    const ringAlpha = Math.round((28 + 6 * breath) * op);

    layers.push(
      new IconLayer({
        id: `${prefix}-ring-0`,
        pickable: false,
        visible: active && ringAlpha >= 2,
        data,
        opacity: globeFade,
        getPosition: (d: { position: [number, number, number] }) => d.position,
        getIcon: () => "ring",
        getSize: ringSize,
        getColor: [70, 165, 235, ringAlpha],
        iconAtlas: ringUrl,
        iconMapping: RING_MAPPING,
        billboard: true,
        sizeUnits: "pixels",
        sizeScale: 1,
      }),
    );
  }

  return { layers, shouldClearPrev };
}

import { IconLayer, PathLayer } from "@deck.gl/layers";
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import type { ElevatedPoint } from "./flight-layer-constants";
import {
  TRAIL_BELOW_AIRCRAFT_METERS,
  TRAIL_SMOOTHING_ITERATIONS,
  SELECTION_FADE_MS,
} from "./flight-layer-constants";
import {
  PULSE_PERIOD_MS,
  RING_PERIOD_MS,
  HALO_MAPPING,
  RING_MAPPING,
} from "./aircraft-appearance";
import {
  buildStartupFallbackTrail,
  buildVisibleTrailPoints,
  buildTrailBasePath,
  trailBasePathCacheKey,
  smoothStep,
} from "./flight-animation-helpers";

// ── Slope limiter (post-elevation-exaggeration) ────────────────────────

/**
 * Maximum elevation-change-per-degree ratio for rendered trail paths.
 * One degree of latitude ≈ 111 km.  A ratio of 80 000 means
 * max visual slope ≈ 80 km rise per 111 km horizontal ≈ ~36°.
 */
const MAX_ELEV_GRADIENT = 80_000;

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
    return [p[0], p[1], Math.max(0, (fwd[i] + bwd[i]) / 2)];
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

export function buildTrailLayers(params: TrailLayerParams) {
  const {
    interpolated,
    interpolatedMap,
    currentTrails,
    trailMap,
    trailDistance,
    trailThickness,
    altColors,
    defaultColor,
    visualFrame,
    globeFade,
    elevScale,
    visible = true,
    trailBasePathCache,
    trailPathCache,
    trailColorCache,
    handledIdsSet,
    visibleTrailCacheMap,
    activeIcaosSet,
  } = params;

  const handledIds = handledIdsSet ?? new Set<string>();
  handledIds.clear();
  const trailData: TrailEntry[] = [];
  const smoothingIters =
    interpolated.length > 220 ? 2 : TRAIL_SMOOTHING_ITERATIONS;

  const visibleTrailCache =
    visibleTrailCacheMap ?? new Map<string, ElevatedPoint[]>();
  visibleTrailCache.clear();
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
        basePath = buildTrailBasePath(trail, trailDistance);
        trailBasePathCache.set(trail.icao24, { key, basePath });
      }
      activeIcaos?.add(trail.icao24);
    }

    const computed = buildVisibleTrailPoints(
      trail,
      animFlight,
      trailDistance,
      smoothingIters,
      basePath,
    );
    visibleTrailCache.set(trail.icao24, computed);
    return computed;
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
  if (trailColorCache && activeIcaos) {
    for (const icao of trailColorCache.keys()) {
      if (!activeIcaos.has(icao)) trailColorCache.delete(icao);
    }
  }

  return new PathLayer<TrailEntry>({
    id: "flight-trails",
    pickable: false,
    visible,
    data: trailData,
    opacity: globeFade,
    updateTriggers: {
      getPath: [visualFrame, trailDistance, elevScale],
      getColor: [visualFrame, altColors, trailDistance],
    },
    getPath: (d) => {
      const animFlight = interpolatedMap.get(d.icao24);

      // Cache key: trail point count + rounded head position (~11m grid)
      // + elevScale. Gives ~6 frame cache hits between invalidations at
      // typical aircraft speed, reducing slope-limit computation from
      // 60fps to ~10fps per trail.
      const headLng = animFlight?.longitude?.toFixed(4) ?? "";
      const headLat = animFlight?.latitude?.toFixed(4) ?? "";
      const pathKey = `${d.path.length}_${headLng}_${headLat}_${elevScale.toFixed(3)}_${trailDistance}`;

      if (trailPathCache) {
        const cached = trailPathCache.get(d.icao24);
        if (cached && cached.key === pathKey) return cached.result;
      }

      const raw = getVisibleTrailPoints(d, animFlight).map(
        (p) =>
          [
            p[0],
            p[1],
            Math.max(
              0,
              (altitudeToElevation(p[2]) - TRAIL_BELOW_AIRCRAFT_METERS) *
                elevScale,
            ),
          ] as [number, number, number],
      );
      const result = limitTrailSlope(raw);
      trailPathCache?.set(d.icao24, { key: pathKey, result });
      return result;
    },
    getColor: (d) => {
      const animFlight = interpolatedMap.get(d.icao24);
      const visiblePoints = getVisibleTrailPoints(d, animFlight);
      const len = visiblePoints.length;

      const colorKey = `${len}_${altColors}_${d.fullHistory ?? false}_${d.baroAltitude != null ? Math.round(d.baroAltitude / 200) : "n"}`;
      if (trailColorCache) {
        const cached = trailColorCache.get(d.icao24);
        if (cached && cached.key === colorKey) return cached.result;
      }

      const isFullHist = d.fullHistory === true;
      const result = visiblePoints.map((point, i) => {
        const tVal = len > 1 ? i / (len - 1) : 1;
        const fade = isFullHist
          ? 0.35 + 0.65 * Math.pow(tVal, 1.1)
          : 0.15 + 0.85 * Math.pow(tVal, 1.4);
        const base = altColors ? altitudeToColor(point[2]) : defaultColor;
        const alpha = isFullHist
          ? Math.round(55 + fade * 165)
          : Math.round(60 + fade * 160);
        return [base[0], base[1], base[2], alpha];
      }) as [number, number, number, number][];
      trailColorCache?.set(d.icao24, { key: colorKey, result });
      return result;
    },
    getWidth: trailThickness,
    widthUnits: "pixels",
    widthMinPixels: Math.max(1, trailThickness * 0.6),
    widthMaxPixels: Math.max(2, trailThickness * 1.8),
    wrapLongitude: true,
    billboard: true,
    capRounded: true,
    jointRounded: true,
  });
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
  // Always emit all 8 IDs; use `visible` to toggle rather than omitting layers.
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
        ? altitudeToElevation(flight.baroAltitude) * elevScale
        : 0;
    const pos: [number, number, number] =
      flight && flight.longitude != null && flight.latitude != null
        ? [flight.longitude, flight.latitude, elevation]
        : [0, 0, 0];
    const data = active ? [{ position: pos }] : EMPTY_PULSE_DATA;

    const breathT = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    const breath = Math.sin(breathT * Math.PI * 2);
    const softBreath = smoothStep(smoothStep((breath + 1) / 2)) * 2 - 1;

    const haloSize = 90 + 10 * softBreath;
    const haloAlpha = Math.round((22 + 10 * softBreath) * op);

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

    const ringOffsets = [0, RING_PERIOD_MS / 3, (RING_PERIOD_MS * 2) / 3];
    ringOffsets.forEach((offset, i) => {
      const t = ((elapsed + offset) % RING_PERIOD_MS) / RING_PERIOD_MS;
      const eased = 1 - (1 - t) ** 5;
      const ringSize = 35 + 70 * eased;
      const fade = 1 - t;
      const ringAlpha = Math.round(80 * fade * fade * fade * fade * op);

      layers.push(
        new IconLayer({
          id: `${prefix}-ring-${i}`,
          pickable: false,
          visible: active && ringAlpha >= 2,
          data,
          opacity: globeFade,
          getPosition: (d: { position: [number, number, number] }) =>
            d.position,
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
    });
  }

  return { layers, shouldClearPrev };
}

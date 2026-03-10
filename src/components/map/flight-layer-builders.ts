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
  trailDistance: number;
  trailThickness: number;
  altColors: boolean;
  defaultColor: [number, number, number, number];
  elapsed: number;
  globeFade: number;
  currentZoom: number;
  visible?: boolean;
}

export function buildTrailLayers(params: TrailLayerParams) {
  const {
    interpolated,
    interpolatedMap,
    currentTrails,
    trailDistance,
    trailThickness,
    altColors,
    defaultColor,
    elapsed,
    globeFade,
    currentZoom,
    visible = true,
  } = params;

  const trailMap = new Map(currentTrails.map((t) => [t.icao24, t]));
  const handledIds = new Set<string>();
  const trailData: TrailEntry[] = [];
  const denseSubdivisions = 2;
  const smoothingIters =
    interpolated.length > 220 ? 2 : TRAIL_SMOOTHING_ITERATIONS;

  const visibleTrailCache = new Map<string, ElevatedPoint[]>();
  const getVisibleTrailPoints = (
    trail: TrailEntry,
    animFlight: FlightState | undefined,
  ): ElevatedPoint[] => {
    const cached = visibleTrailCache.get(trail.icao24);
    if (cached) return cached;
    const computed = buildVisibleTrailPoints(
      trail,
      animFlight,
      trailDistance,
      smoothingIters,
      denseSubdivisions,
    );
    visibleTrailCache.set(trail.icao24, computed);
    return computed;
  };

  for (const f of interpolated) {
    if (f.longitude == null || f.latitude == null) continue;
    const existing = trailMap.get(f.icao24);
    handledIds.add(f.icao24);
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
      baroAltitude: existing?.baroAltitude ?? f.baroAltitude,
    });
  }

  for (const d of currentTrails) {
    if (!handledIds.has(d.icao24)) trailData.push(d);
  }

  return new PathLayer<TrailEntry>({
    id: "flight-trails",
    visible,
    data: trailData,
    opacity: globeFade,
    updateTriggers: {
      getPath: [elapsed, trailDistance],
      getColor: [elapsed, altColors, trailDistance],
    },
    getPath: (d) => {
      const animFlight = interpolatedMap.get(d.icao24);
      // Scale elevation exaggeration by zoom:
      // At globe zoom (<5) altitude spikes look absurd, so reduce.
      // At city zoom (>8) full exaggeration is needed for visual depth.
      const elevScale =
        currentZoom < 5
          ? 0.15 + (currentZoom / 5) * 0.35
          : currentZoom < 8
            ? 0.5 + ((currentZoom - 5) / 3) * 0.5
            : 1.0;
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
      return limitTrailSlope(raw);
    },
    getColor: (d) => {
      const animFlight = interpolatedMap.get(d.icao24);
      const visiblePoints = getVisibleTrailPoints(d, animFlight);
      const len = visiblePoints.length;
      const isFullHist = d.fullHistory === true;

      return visiblePoints.map((point, i) => {
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
  elapsed: number;
  globeFade: number;
  currentZoom: number;
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
    interpolated,
    elapsed,
    globeFade,
    currentZoom,
    haloUrl,
    ringUrl,
    layersVisible = true,
  } = params;

  // Zoom-dependent elevation scale (matches trail/aircraft scaling)
  const elevScale =
    currentZoom < 5
      ? 0.15 + (currentZoom / 5) * 0.35
      : currentZoom < 8
        ? 0.5 + ((currentZoom - 5) / 3) * 0.5
        : 1.0;

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

    const flight = targetId
      ? interpolated.find((f) => f.icao24 === targetId)
      : undefined;
    const hasPosition =
      flight && flight.longitude != null && flight.latitude != null;

    const active = layersVisible && !!targetId && hasPosition && op > 0.01;
    const pos: [number, number, number] = hasPosition
      ? [
          flight!.longitude!,
          flight!.latitude!,
          altitudeToElevation(flight!.baroAltitude) * elevScale,
        ]
      : [0, 0, 0];
    const data = active ? [{ position: pos }] : EMPTY_PULSE_DATA;

    const breathT = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    const breath = Math.sin(breathT * Math.PI * 2);
    const softBreath = smoothStep(smoothStep((breath + 1) / 2)) * 2 - 1;

    const haloSize = 75 + 8 * softBreath;
    const haloAlpha = Math.round((18 + 8 * softBreath) * op);

    layers.push(
      new IconLayer({
        id: `${prefix}-halo`,
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
      const ringSize = 30 + 60 * eased;
      const fade = 1 - t;
      const ringAlpha = Math.round(70 * fade * fade * fade * fade * op);

      layers.push(
        new IconLayer({
          id: `${prefix}-ring-${i}`,
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

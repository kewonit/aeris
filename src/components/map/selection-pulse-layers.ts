import { IconLayer } from "@deck.gl/layers";

import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { altitudeToElevation } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";

import {
  HALO_MAPPING,
  PULSE_PERIOD_MS,
  RING_MAPPING,
} from "./aircraft-appearance";
import { SELECTION_FADE_MS } from "./flight-layer-constants";
import { smoothStep } from "./flight-math";

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
    // Animate only during the finite selection transition. Keeping a selected
    // ring static afterwards lets the flight renderer sleep between updates.
    const breath = fadeT < 1 ? Math.sin(breathT * Math.PI * 2) : 0;

    // Subtle background glow - barely visible, provides soft ambient light.
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
    // No expansion animation - just a calm, static indicator.
    // In sync with halo (no phase offset) for a unified pulse.
    // At 68px, ring inner edge = 0.57 * 34 = 19px - clears the aircraft.
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

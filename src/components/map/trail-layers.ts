import { PathLayer } from "@deck.gl/layers";

import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { altitudeToColor } from "@/lib/flight-utils";
import { snapLngToReference } from "@/lib/geo";
import type { FlightState } from "@/lib/opensky";
import type { TrailTrack } from "@/lib/trails/types";

import { getAircraftModelCalibration } from "./aircraft-model-calibration";
import { resolveModelKeyCached } from "./aircraft-model-mapping";
import { projectTrailElevationMeters } from "./altitude-projection";
import { horizontalDistanceFromLngLat } from "./flight-math";
import {
  getTrailGeometry,
  type Rgba,
  type TrailBody,
  type TrailGeometryCache,
  type TrailHeadAnchor,
  type TrailVertex,
} from "./trail-geometry";

export type TrailHead = {
  path: [TrailVertex, TrailVertex];
  colors: [Rgba, Rgba];
};

export type TrailRenderCache = {
  geometry: TrailGeometryCache;
  bodies: TrailBody[];
};

export function createTrailRenderCache(): TrailRenderCache {
  return { geometry: new Map(), bodies: [] };
}

type HeadOptions = {
  altColors: boolean;
  altitudeDisplayMode: AltitudeDisplayMode;
  elevScale: number;
  defaultColor: Rgba;
};

/**
 * The straight line from the trail's second-newest sample to the aircraft,
 * which is the line the aircraft itself is animating along. It stops at the
 * model's tail so it never runs through or ahead of the aircraft.
 */
export function buildTrailHead(
  anchor: TrailHeadAnchor,
  flight: FlightState,
  options: HeadOptions,
): TrailHead | null {
  if (flight.longitude == null || flight.latitude == null) return null;

  const [startLng, startLat, startZ] = anchor.vertex;
  const lng = snapLngToReference(flight.longitude, startLng);
  const lat = flight.latitude;
  const distance = horizontalDistanceFromLngLat(startLng, startLat, lng, lat);
  const tailGap = getAircraftModelCalibration(
    resolveModelKeyCached(flight),
  ).tailAnchorMeters;
  if (distance <= tailGap) return null;

  const altitude = flight.onGround ? 0 : flight.baroAltitude;
  const endZ = Math.max(
    0,
    projectTrailElevationMeters(altitude, options.altitudeDisplayMode) *
      options.elevScale,
  );
  const u = (distance - tailGap) / distance;
  const [r, g, b] = options.altColors
    ? altitudeToColor(altitude)
    : options.defaultColor;

  return {
    path: [
      anchor.vertex,
      [
        startLng + (lng - startLng) * u,
        startLat + (lat - startLat) * u,
        startZ + (endZ - startZ) * u,
      ],
    ],
    colors: [anchor.color, [r, g, b, anchor.headAlpha]],
  };
}

export type TrailLayerParams = HeadOptions & {
  /** The aircraft drawn this frame; only they get trails. */
  flights: FlightState[];
  trailMap: Map<string, TrailTrack>;
  selectedIcao24: string | null;
  trailMinutes: number;
  thickness: number;
  opacity: number;
  cache: TrailRenderCache;
};

export function buildTrailLayers(params: TrailLayerParams) {
  const bodies: TrailBody[] = [];
  const heads: TrailHead[] = [];
  const drawn = new Set<string>();
  const windowMs = params.trailMinutes * 60_000;

  for (const flight of params.flights) {
    const track = params.trailMap.get(flight.icao24);
    if (!track) continue;
    drawn.add(track.icao24);

    const geometry = getTrailGeometry(params.cache.geometry, track, {
      // The selected aircraft shows its whole route once history arrives.
      windowMs:
        track.icao24 === params.selectedIcao24 && track.hasHistory
          ? null
          : windowMs,
      altitudeDisplayMode: params.altitudeDisplayMode,
      elevScale: params.elevScale,
      altColors: params.altColors,
      defaultColor: params.defaultColor,
    });
    bodies.push(...geometry.bodies);

    const head = geometry.anchor
      ? buildTrailHead(geometry.anchor, flight, params)
      : null;
    if (head) heads.push(head);
  }

  for (const icao24 of params.cache.geometry.keys()) {
    if (!drawn.has(icao24)) params.cache.geometry.delete(icao24);
  }

  // Keep the previous array while no trail changed, so deck.gl does not
  // re-tessellate every trail on every frame.
  const previous = params.cache.bodies;
  const unchanged =
    previous.length === bodies.length &&
    bodies.every((body, index) => body === previous[index]);
  params.cache.bodies = unchanged ? previous : bodies;

  // Square caps and miter joints: round ones on translucent lines overlap
  // where two segments meet and leave a darker dot at every vertex.
  const shared = {
    pickable: false,
    opacity: params.opacity,
    widthUnits: "pixels" as const,
    getWidth: params.thickness,
    capRounded: false,
    jointRounded: false,
    billboard: true,
  };

  return [
    new PathLayer<TrailBody>({
      ...shared,
      id: "flight-trails",
      data: params.cache.bodies,
      getPath: (body) => body.path,
      getColor: (body) => body.colors,
    }),
    new PathLayer<TrailHead>({
      ...shared,
      id: "flight-trail-heads",
      data: heads,
      getPath: (head) => head.path,
      getColor: (head) => head.colors,
    }),
  ];
}

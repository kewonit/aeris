import { PathLayer } from "@deck.gl/layers";

import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { altitudeToColor } from "@/lib/flight-utils";
import { snapLngToReference } from "@/lib/geo";
import type { FlightState } from "@/lib/opensky";
import type { TrailTrack } from "@/lib/trails/types";

import { metersPerPixel, type AircraftScreenSize } from "./aircraft-size";
import { projectDisplayedAltitudeMeters } from "./altitude-projection";
import {
  getTrailGeometry,
  type Rgba,
  type TrailBody,
  type TrailGeometryCache,
  type TrailHeadAnchor,
  type TrailVertex,
} from "./trail-geometry";

const METERS_PER_DEGREE = 111_320;
const HEAD_STEPS = 10;

export type TrailHead = {
  path: TrailVertex[];
  colors: Rgba[];
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
  zoom: number;
};

function cubic(a: number, b: number, c: number, d: number, u: number) {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
}

/**
 * The stretch from the trail's second-newest sample into the aircraft's
 * tail, rebuilt every frame as the aircraft moves. It leaves the trail
 * along the trail's own direction and arrives along the heading the model
 * is drawn with, so it always enters the tail straight on, whatever the
 * model's size or the aircraft's crab angle.
 */
export function buildTrailHead(
  anchor: TrailHeadAnchor,
  flight: FlightState,
  size: AircraftScreenSize,
  options: HeadOptions,
): TrailHead | null {
  if (flight.longitude == null || flight.latitude == null) return null;

  const [startLng, startLat, startZ] = anchor.vertex;
  const lng = snapLngToReference(flight.longitude, startLng);
  const lat = flight.latitude;
  const metersPerLng = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);

  // Positions relative to the anchor, in metres east and north.
  const aircraftEast = (lng - startLng) * metersPerLng;
  const aircraftNorth = (lat - startLat) * METERS_PER_DEGREE;
  const distance = Math.hypot(aircraftEast, aircraftNorth);
  // The model's half-length on screen, in metres at the aircraft's height.
  const halfLength =
    (size.tailShare * size.footprintPx * metersPerPixel(options.zoom, lat)) /
    size.magnification;
  // Until the aircraft has cleared the anchor, the trail ends under it.
  if (!(distance > halfLength)) return null;

  const track = flight.trueTrack;
  const [headingEast, headingNorth] =
    track != null && Number.isFinite(track)
      ? [Math.sin((track * Math.PI) / 180), Math.cos((track * Math.PI) / 180)]
      : [aircraftEast / distance, aircraftNorth / distance];
  const tailEast = aircraftEast - headingEast * halfLength;
  const tailNorth = aircraftNorth - headingNorth * halfLength;
  const span = Math.hypot(tailEast, tailNorth);
  if (!(span > 0)) return null;

  // A heading that points back at the trail would loop the curve, so the
  // join is straight then.
  const curved =
    (tailEast * headingEast + tailNorth * headingNorth) / span > 0;
  const [leaveEast, leaveNorth] = anchor.tangent ?? [
    tailEast / span,
    tailNorth / span,
  ];
  const reach = span / 3;

  const altitude = flight.onGround ? 0 : flight.baroAltitude;
  // The trail rides just below the aircraft and rises to meet the tail.
  const endZ = Math.max(
    0,
    projectDisplayedAltitudeMeters(altitude, options.altitudeDisplayMode) *
      options.elevScale,
  );
  const [r, g, b] = options.altColors
    ? altitudeToColor(altitude)
    : options.defaultColor;
  const endColor: Rgba = [r, g, b, anchor.headAlpha];

  const steps = curved ? HEAD_STEPS : 1;
  const path: TrailVertex[] = [];
  const colors: Rgba[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const u = step / steps;
    const east = curved
      ? cubic(0, leaveEast * reach, tailEast - headingEast * reach, tailEast, u)
      : tailEast * u;
    const north = curved
      ? cubic(
          0,
          leaveNorth * reach,
          tailNorth - headingNorth * reach,
          tailNorth,
          u,
        )
      : tailNorth * u;
    path.push([
      startLng + east / metersPerLng,
      startLat + north / METERS_PER_DEGREE,
      startZ + (endZ - startZ) * u,
    ]);
    colors.push(
      anchor.color.map(
        (channel, index) => channel + (endColor[index] - channel) * u,
      ) as Rgba,
    );
  }
  return { path, colors };
}

export type TrailLayerParams = HeadOptions & {
  /** The aircraft drawn this frame; only they get trails. */
  flights: FlightState[];
  /** Each aircraft's drawn size this frame, keyed by icao24. */
  aircraftSizes: Map<string, AircraftScreenSize>;
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

    const size = params.aircraftSizes.get(flight.icao24);
    const head =
      geometry.anchor && size
        ? buildTrailHead(geometry.anchor, flight, size, params)
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

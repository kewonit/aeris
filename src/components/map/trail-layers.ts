import { PathLayer } from "@deck.gl/layers";

import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { altitudeToColor } from "@/lib/flight-utils";
import { snapLngToReference } from "@/lib/geo";
import type { FlightState } from "@/lib/opensky";
import type { TrailTrack } from "@/lib/trails/types";

import { aircraftColor } from "./aircraft-appearance";
import { metersPerPixel, type AircraftScreenSize } from "./aircraft-size";
import { aircraftElevationMeters } from "./altitude-projection";
import {
  getTrailGeometry,
  type Rgba,
  type TrailBody,
  type TrailGeometryCache,
  type TrailLead,
  type TrailVertex,
} from "./trail-geometry";

const METERS_PER_DEGREE = 111_320;
const HEAD_STEPS = 10;
/**
 * The head keeps the lead only where it lies this many half-lengths from
 * the aircraft's centre, so the curve into the tail has room to turn.
 */
const LEAD_CLEARANCE_HALF_LENGTHS = 2;

export type TrailHead = {
  icao24: string;
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
  /** Height in metres that no aircraft or trail is drawn above. */
  heightCeiling: number;
  defaultColor: Rgba;
  zoom: number;
};

function cubic(a: number, b: number, c: number, d: number, u: number) {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
}

/**
 * The newest stretch of trail and the curve from it into the aircraft's
 * tail, rebuilt every frame as the aircraft moves. The lead is kept up to
 * where the aircraft has caught up with it; the curve leaves it along the
 * trail's own direction and arrives along the heading the model is drawn
 * with, so the trail always enters the tail straight on, whatever the
 * model's size or the aircraft's crab angle.
 */
export function buildTrailHead(
  lead: TrailLead,
  flight: FlightState,
  size: AircraftScreenSize,
  options: HeadOptions,
): TrailHead | null {
  if (flight.longitude == null || flight.latitude == null) return null;

  const lat = flight.latitude;
  const lng = snapLngToReference(flight.longitude, lead.path[0][0]);
  const metersPerLng = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  // Positions relative to the aircraft, in metres east and north.
  const local = ([vertexLng, vertexLat]: TrailVertex): [number, number] => [
    (vertexLng - lng) * metersPerLng,
    (vertexLat - lat) * METERS_PER_DEGREE,
  ];

  const track = flight.trueTrack;
  const [lastEast, lastNorth] = local(lead.path[lead.path.length - 1]);
  const lastDistance = Math.hypot(lastEast, lastNorth);
  const heading: [number, number] | null =
    track != null && Number.isFinite(track)
      ? [Math.sin((track * Math.PI) / 180), Math.cos((track * Math.PI) / 180)]
      : lastDistance > 0
        ? [-lastEast / lastDistance, -lastNorth / lastDistance]
        : null;
  if (!heading) return null;
  const [headingEast, headingNorth] = heading;

  // The model's half-length on screen, in metres at the aircraft's height.
  const halfLength =
    (size.tailShare * size.footprintPx * metersPerPixel(options.zoom, lat)) /
    size.magnification;
  const tailEast = -headingEast * halfLength;
  const tailNorth = -headingNorth * halfLength;
  const behindTail = ([east, north]: [number, number]) =>
    (tailEast - east) * headingEast + (tailNorth - north) * headingNorth;
  const clearOfAircraft = (vertex: TrailVertex) => {
    const position = local(vertex);
    return (
      behindTail(position) > 0 &&
      Math.hypot(position[0], position[1]) >=
        LEAD_CLEARANCE_HALF_LENGTHS * halfLength
    );
  };

  // Drop the lead's newest vertices while the aircraft is over them, or
  // they would end the trail beside the fuselage. A slow aircraft drawn
  // far larger than life can cover all of it; the join then starts from
  // the lead's first vertex, where the cached trail ends.
  let startIndex = lead.path.length - 1;
  while (startIndex > 0 && !clearOfAircraft(lead.path[startIndex])) {
    startIndex -= 1;
  }

  const start = lead.path[startIndex];
  const [startEast, startNorth] = local(start);
  const spanEast = tailEast - startEast;
  const spanNorth = tailNorth - startNorth;
  const span = Math.hypot(spanEast, spanNorth);
  if (!(span > 0)) return null;
  const tangent = lead.tangents[startIndex];
  // A trail leaving away from the tail would loop, so it leaves towards it.
  const [leaveEast, leaveNorth] =
    tangent && tangent[0] * spanEast + tangent[1] * spanNorth > 0
      ? tangent
      : [spanEast / span, spanNorth / span];
  const reach = span / 3;

  const altitude = flight.onGround ? 0 : flight.baroAltitude;
  // The trail rides just below the aircraft and rises to meet the tail.
  const startZ = start[2];
  const endZ = Math.max(
    0,
    aircraftElevationMeters(
      altitude,
      options.altitudeDisplayMode,
      options.elevScale,
      options.heightCeiling,
    ),
  );
  const base = options.altColors
    ? altitudeToColor(altitude)
    : options.defaultColor;
  const [r, g, b] = aircraftColor(base, flight);
  const endColor: Rgba = [r, g, b, lead.headAlpha];
  const startColor = lead.colors[startIndex];

  const path = lead.path.slice(0, startIndex + 1);
  const colors = lead.colors.slice(0, startIndex + 1);
  for (let step = 1; step <= HEAD_STEPS; step += 1) {
    // Samples bunch up at both ends, so the last segment lies along the
    // heading rather than cutting the curve at an angle.
    const t = step / HEAD_STEPS;
    const u = t * t * (3 - 2 * t);
    const east = cubic(
      startEast,
      startEast + leaveEast * reach,
      tailEast - headingEast * reach,
      tailEast,
      u,
    );
    const north = cubic(
      startNorth,
      startNorth + leaveNorth * reach,
      tailNorth - headingNorth * reach,
      tailNorth,
      u,
    );
    path.push([
      lng + east / metersPerLng,
      lat + north / METERS_PER_DEGREE,
      startZ + (endZ - startZ) * u,
    ]);
    colors.push(
      startColor.map(
        (channel, index) => channel + (endColor[index] - channel) * u,
      ) as Rgba,
    );
  }
  return { icao24: flight.icao24, path, colors };
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
      heightCeiling: params.heightCeiling,
      appearance: flight,
    });
    bodies.push(...geometry.bodies);

    const size = params.aircraftSizes.get(flight.icao24);
    const head =
      geometry.lead && size
        ? buildTrailHead(geometry.lead, flight, size, params)
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

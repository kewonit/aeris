import { LayerExtension } from "@deck.gl/core";
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
/** A faint, wide halo under each trail, so it reads as light, not wire. */
const GLOW_WIDTH_SCALE = 4;
const GLOW_EXTRA_PX = 3;
const GLOW_OPACITY = 0.2;
/**
 * The halo fades in between these zooms. Further out, trails are a few
 * pixels long and their curve steps far under a pixel, so a halo only
 * piles up into bright specks where its corners overlap.
 */
const GLOW_HIDDEN_ZOOM = 8;
const GLOW_FULL_ZOOM = 9.5;

/**
 * Fades a path from full colour on its centre line to nothing at its
 * edges. deck gives each fragment its offset across the path, from -1 at
 * one edge to 1 at the other.
 */
class SoftEdgeExtension extends LayerExtension {
  static extensionName = "SoftEdgeExtension";

  getShaders() {
    return {
      inject: {
        "fs:DECKGL_FILTER_COLOR": `
          float fromEdge = 1.0 - min(abs(geometry.uv.x), 1.0);
          color.a *= fromEdge * fromEdge;
        `,
      },
    };
  }
}

// One shared instance: a new one each frame would rebuild the shaders.
const SOFT_EDGE = [new SoftEdgeExtension()];

/**
 * The head keeps the lead only where it lies this many half-lengths, and
 * at least this many pixels, from the aircraft's centre, so the curve from
 * the trail's direction onto the heading turns gently enough to read as
 * one line.
 */
const LEAD_CLEARANCE_HALF_LENGTHS = 3;
const LEAD_CLEARANCE_PX = 48;
/**
 * A trail hidden by the height limit returns only once its aircraft is
 * this far below it, so one levelled off at the limit does not flicker.
 */
const CEILING_HYSTERESIS_METERS = 60;

export type TrailHead = {
  icao24: string;
  path: TrailVertex[];
  colors: Rgba[];
};

export type TrailRenderCache = {
  geometry: TrailGeometryCache;
  bodies: TrailBody[];
  /** Aircraft whose trails the height limit hid last frame. */
  aboveCeiling: Set<string>;
};

export function createTrailRenderCache(): TrailRenderCache {
  return { geometry: new Map(), bodies: [], aboveCeiling: new Set() };
}

type HeadOptions = {
  altColors: boolean;
  altitudeDisplayMode: AltitudeDisplayMode;
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
 * trail's own direction and arrives at the tail as the model is drawn,
 * along its heading and at its pitched height, so the trail always enters
 * the tail straight on, whatever the model's size, crab angle or climb.
 *
 * @param pitchDegrees The model's drawn pitch, in deck's sense: negative
 *   raises the nose, which lowers the tail.
 */
export function buildTrailHead(
  lead: TrailLead,
  flight: FlightState,
  size: AircraftScreenSize,
  options: HeadOptions,
  pitchDegrees = 0,
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

  // One screen pixel, and the model's half-length on screen, in metres at
  // the aircraft's height.
  const pixel = metersPerPixel(options.zoom, lat) / size.magnification;
  const halfLength = size.tailShare * size.footprintPx * pixel;
  const clearance = Math.max(
    LEAD_CLEARANCE_HALF_LENGTHS * halfLength,
    LEAD_CLEARANCE_PX * pixel,
  );
  // A pitched model's tail sits nearer, and lower when climbing or higher
  // when descending, than a level one's.
  const climb = (-pitchDegrees * Math.PI) / 180;
  const tailBehind = halfLength * Math.cos(climb);
  const tailEast = -headingEast * tailBehind;
  const tailNorth = -headingNorth * tailBehind;
  const behindTail = ([east, north]: [number, number]) =>
    (tailEast - east) * headingEast + (tailNorth - north) * headingNorth;
  const clearOfAircraft = (vertex: TrailVertex) => {
    const position = local(vertex);
    return (
      behindTail(position) > 0 &&
      Math.hypot(position[0], position[1]) >= clearance
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
  // The trail rides at the aircraft's height, so the head only climbs or
  // descends as far as the aircraft has since the lead's sample. The model
  // is pitched along that same drawn slope, so ending at its tail, rather
  // than level with its centre, has the trail run straight into it.
  const startZ = start[2];
  const tailZ =
    aircraftElevationMeters(altitude, options.altitudeDisplayMode) -
    halfLength * Math.sin(climb);
  const base = options.altColors
    ? altitudeToColor(altitude)
    : options.defaultColor;
  const [r, g, b] = aircraftColor(base, flight);
  const endColor: Rgba = [r, g, b, lead.headAlpha];
  const startColor = lead.colors[startIndex];

  const path = lead.path.slice(0, startIndex + 1);
  const colors = lead.colors.slice(0, startIndex + 1);
  let keptEast = startEast;
  let keptNorth = startNorth;
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
    // Points under a pixel apart only add joints whose overlapping corners
    // blend twice into bright, flickering specks; the tail is always kept.
    if (
      step < HEAD_STEPS &&
      Math.hypot(east - keptEast, north - keptNorth) < pixel
    ) {
      continue;
    }
    keptEast = east;
    keptNorth = north;
    path.push([
      lng + east / metersPerLng,
      lat + north / METERS_PER_DEGREE,
      startZ + (tailZ - startZ) * u,
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
  /** Each 3D model's drawn pitch, keyed by icao24; flat icons have none. */
  pitchByIcao: Map<string, number>;
  trailMap: Map<string, TrailTrack>;
  selectedIcao24: string | null;
  trailMinutes: number;
  /** Aircraft flying above this many metres get no trail; null for none. */
  ceilingMeters: number | null;
  /** Whether trails get their halo; off from the cockpit. */
  glow: boolean;
  thickness: number;
  opacity: number;
  cache: TrailRenderCache;
};

/**
 * Whether the height limit hides an aircraft's trail. The selected
 * aircraft and aircraft on the ground always keep theirs.
 */
function isAboveCeiling(
  flight: FlightState,
  params: TrailLayerParams,
): boolean {
  const altitude = flight.baroAltitude;
  if (
    params.ceilingMeters == null ||
    flight.icao24 === params.selectedIcao24 ||
    flight.onGround ||
    altitude == null ||
    !Number.isFinite(altitude)
  ) {
    return false;
  }
  const limit = params.cache.aboveCeiling.has(flight.icao24)
    ? params.ceilingMeters - CEILING_HYSTERESIS_METERS
    : params.ceilingMeters;
  return altitude > limit;
}

export function buildTrailLayers(params: TrailLayerParams) {
  const bodies: TrailBody[] = [];
  const heads: TrailHead[] = [];
  const drawn = new Set<string>();
  const aboveCeiling = new Set<string>();
  const windowMs = params.trailMinutes * 60_000;

  for (const flight of params.flights) {
    if (isAboveCeiling(flight, params)) {
      aboveCeiling.add(flight.icao24);
      continue;
    }
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
      altColors: params.altColors,
      defaultColor: params.defaultColor,
      appearance: flight,
    });
    bodies.push(...geometry.bodies);

    const size = params.aircraftSizes.get(flight.icao24);
    const head =
      geometry.lead && size
        ? buildTrailHead(
            geometry.lead,
            flight,
            size,
            params,
            params.pitchByIcao.get(flight.icao24),
          )
        : null;
    if (head) heads.push(head);
  }

  params.cache.aboveCeiling = aboveCeiling;
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

  // Flat caps and miter joints: round ones on translucent lines overlap
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
  // The halo reuses the trails' own data, so it costs no extra geometry,
  // fades out towards its edges, and writes no depth, so it never hides a
  // trail drawn behind it. Hidden, it stays in the list so deck keeps its
  // buffers for zooming back in.
  const zoomIn = Math.min(
    1,
    Math.max(
      0,
      (params.zoom - GLOW_HIDDEN_ZOOM) / (GLOW_FULL_ZOOM - GLOW_HIDDEN_ZOOM),
    ),
  );
  const glowShare = params.glow ? zoomIn * zoomIn * (3 - 2 * zoomIn) : 0;
  const glow = {
    ...shared,
    visible: glowShare > 0,
    opacity: params.opacity * GLOW_OPACITY * glowShare,
    getWidth: params.thickness * GLOW_WIDTH_SCALE + GLOW_EXTRA_PX,
    parameters: { depthWriteEnabled: false },
    extensions: SOFT_EDGE,
  };

  return [
    new PathLayer<TrailBody>({
      ...glow,
      id: "flight-trail-glow",
      data: params.cache.bodies,
      getPath: (body) => body.path,
      getColor: (body) => body.colors,
    }),
    new PathLayer<TrailHead>({
      ...glow,
      id: "flight-trail-head-glow",
      data: heads,
      getPath: (head) => head.path,
      getColor: (head) => head.colors,
    }),
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

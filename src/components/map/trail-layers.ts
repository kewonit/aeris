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
/** Halvings that place the join's start along a lead segment, to 1/4096. */
const START_SEARCH_STEPS = 12;
/**
 * When a new sample reshapes the newest stretch of trail, as when the
 * aircraft turns harder or eases off, the join eases from its old shape
 * to its new one over this long rather than jumping.
 */
const JOIN_EASE_MS = 250;
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

/** Which lead each aircraft's head was last drawn from. */
type JoinState = {
  lead: TrailLead;
  /** The lead before the newest change, while the head eases off it. */
  previous: TrailLead | null;
  changedAt: number;
};

export type TrailRenderCache = {
  geometry: TrailGeometryCache;
  bodies: TrailBody[];
  /** Aircraft whose trails the height limit hid last frame. */
  aboveCeiling: Set<string>;
  joins: Map<string, JoinState>;
};

export function createTrailRenderCache(): TrailRenderCache {
  return {
    geometry: new Map(),
    bodies: [],
    aboveCeiling: new Set(),
    joins: new Map(),
  };
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

function lerpVertex(a: TrailVertex, b: TrailVertex, u: number): TrailVertex {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

function lerpColor(a: Rgba, b: Rgba, u: number): Rgba {
  return a.map((channel, index) => channel + (b[index] - channel) * u) as Rgba;
}

type Direction = [east: number, north: number];

function normalized(east: number, north: number): Direction | null {
  const length = Math.hypot(east, north);
  return length > 0 ? [east / length, north / length] : null;
}

/**
 * The trail's direction through a lead vertex: halfway between the way it
 * arrives and the way it leaves, so the direction turns smoothly as the
 * join's start passes the vertex.
 */
function vertexDirection(lead: TrailLead, index: number): Direction | null {
  const arriving = lead.tangents[index];
  const leaving = lead.tangents[index + 1];
  if (!arriving || !leaving) return arriving ?? leaving ?? null;
  return normalized(arriving[0] + leaving[0], arriving[1] + leaving[1]);
}

function blendDirections(
  a: Direction | null,
  b: Direction | null,
  u: number,
): Direction | null {
  if (!a || !b) return a ?? b;
  return normalized(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
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

  // Drop the lead's newest vertices while the aircraft is over them or
  // ahead of it, or they would end the trail beside the fuselage. A slow
  // aircraft drawn far larger than life can cover all of it; the join then
  // starts from the lead's first vertex, where the cached trail ends.
  let startIndex = lead.path.length - 1;
  while (startIndex > 0 && !clearOfAircraft(lead.path[startIndex])) {
    startIndex -= 1;
  }

  // The join leaves the trail exactly where the trail stops being clear of
  // the aircraft, between the newest clear vertex and the next, so it
  // slides along the trail as the aircraft flies rather than stepping from
  // vertex to vertex.
  let start = lead.path[startIndex];
  let startColor = lead.colors[startIndex];
  let tangent = vertexDirection(lead, startIndex);
  let startBetweenVertices = false;
  const next = startIndex + 1;
  if (next < lead.path.length && clearOfAircraft(start)) {
    const from = lead.path[startIndex];
    const to = lead.path[next];
    let clear = 0;
    let blocked = 1;
    for (let step = 0; step < START_SEARCH_STEPS; step += 1) {
      const middle = (clear + blocked) / 2;
      if (clearOfAircraft(lerpVertex(from, to, middle))) clear = middle;
      else blocked = middle;
    }
    if (clear > 0) {
      start = lerpVertex(from, to, clear);
      startColor = lerpColor(lead.colors[startIndex], lead.colors[next], clear);
      tangent = blendDirections(tangent, vertexDirection(lead, next), clear);
      startBetweenVertices = true;
    }
  }

  const [startEast, startNorth] = local(start);
  const spanEast = tailEast - startEast;
  const spanNorth = tailNorth - startNorth;
  const span = Math.hypot(spanEast, spanNorth);
  if (!(span > 0)) return null;
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

  const path = lead.path.slice(0, startIndex + 1);
  const colors = lead.colors.slice(0, startIndex + 1);
  if (startBetweenVertices) {
    path.push(start);
    colors.push(startColor);
  }
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
  /** The aircraft followed or flown in first person, if any. */
  followIcao24?: string | null;
  /**
   * Whether all traffic draws trails. When false, only the selected and
   * followed aircraft do.
   */
  allTraffic?: boolean;
  trailMinutes: number;
  /** Aircraft flying above this many metres get no trail; null for none. */
  ceilingMeters: number | null;
  /** Whether trails get their halo; off from the cockpit. */
  glow: boolean;
  thickness: number;
  opacity: number;
  cache: TrailRenderCache;
  /** Tells these layers apart from another set built the same frame. */
  idSuffix?: string;
  /** The frame's time in milliseconds, which paces the join's easing. */
  now: number;
};

/** Whether an aircraft is open or followed, and so always keeps its trail. */
function isTracked(icao24: string, params: TrailLayerParams): boolean {
  return (
    (params.selectedIcao24 != null && icao24 === params.selectedIcao24) ||
    (params.followIcao24 != null && icao24 === params.followIcao24)
  );
}

/**
 * Whether the height limit hides an aircraft's trail. The selected and
 * followed aircraft, and aircraft on the ground, always keep theirs.
 */
function isAboveCeiling(
  flight: FlightState,
  params: TrailLayerParams,
): boolean {
  const altitude = flight.baroAltitude;
  if (
    params.ceilingMeters == null ||
    isTracked(flight.icao24, params) ||
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

function joinFor(
  joins: Map<string, JoinState>,
  icao24: string,
  lead: TrailLead,
  now: number,
): JoinState {
  const join = joins.get(icao24);
  if (!join) {
    const fresh = { lead, previous: null, changedAt: now };
    joins.set(icao24, fresh);
    return fresh;
  }
  if (join.lead !== lead) {
    join.previous = join.lead;
    join.lead = lead;
    join.changedAt = now;
  }
  return join;
}

/** Each vertex's distance back along the path from its end, in metres. */
function distancesFromEnd(path: TrailVertex[]): number[] {
  const metersPerLng =
    METERS_PER_DEGREE * Math.cos((path[path.length - 1][1] * Math.PI) / 180);
  const distances = new Array<number>(path.length);
  distances[path.length - 1] = 0;
  for (let index = path.length - 2; index >= 0; index -= 1) {
    const [a, b] = [path[index], path[index + 1]];
    distances[index] =
      distances[index + 1] +
      Math.hypot(
        (b[0] - a[0]) * metersPerLng,
        (b[1] - a[1]) * METERS_PER_DEGREE,
      );
  }
  return distances;
}

/**
 * A head partway from one shape to another. Both end at the same tail, and
 * each point of the new head is drawn partway back to the point the same
 * distance from the tail on the old one. Towards the far end, where both
 * run along the cached trail, the new head takes over, so the head always
 * meets the trail where it now ends.
 *
 * @param share How far the head has eased from `from` to `to`, 0 to 1.
 */
export function easeHead(
  from: TrailHead,
  to: TrailHead,
  share: number,
): TrailHead {
  const fromDistances = distancesFromEnd(from.path);
  const toDistances = distancesFromEnd(to.path);
  const length = toDistances[0];
  if (!(length > 0) || share >= 1) return to;

  const path: TrailVertex[] = [];
  const colors: Rgba[] = [];
  let segment = from.path.length - 2;
  for (let index = to.path.length - 1; index >= 0; index -= 1) {
    const distance = toDistances[index];
    // Walk back along the old head to the segment this distance lies on.
    while (segment > 0 && fromDistances[segment] < distance) segment -= 1;
    const far = Math.min(1, Math.max(0, (2 * distance) / length - 1));
    const keep =
      segment >= 0 && distance <= fromDistances[0]
        ? (1 - share) * (1 - far * far * (3 - 2 * far))
        : 0;
    if (keep <= 0) {
      path.push(to.path[index]);
      colors.push(to.colors[index]);
      continue;
    }
    const near = fromDistances[segment + 1];
    const span = fromDistances[segment] - near;
    const u = span > 0 ? (distance - near) / span : 0;
    const old = lerpVertex(from.path[segment + 1], from.path[segment], u);
    const oldColor = lerpColor(from.colors[segment + 1], from.colors[segment], u);
    path.push(lerpVertex(to.path[index], old, keep));
    colors.push(lerpColor(to.colors[index], oldColor, keep));
  }
  path.reverse();
  colors.reverse();
  return { icao24: to.icao24, path, colors };
}

export function buildTrailLayers(params: TrailLayerParams) {
  const bodies: TrailBody[] = [];
  const heads: TrailHead[] = [];
  const drawn = new Set<string>();
  const aboveCeiling = new Set<string>();
  const windowMs = params.trailMinutes * 60_000;

  const allTraffic = params.allTraffic ?? true;
  for (const flight of params.flights) {
    if (!allTraffic && !isTracked(flight.icao24, params)) continue;
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
    if (!geometry.lead || !size) continue;
    const pitch = params.pitchByIcao.get(flight.icao24);
    let head = buildTrailHead(geometry.lead, flight, size, params, pitch);
    const join = joinFor(params.cache.joins, flight.icao24, geometry.lead, params.now);
    if (head && join.previous) {
      const eased = (params.now - join.changedAt) / JOIN_EASE_MS;
      const old =
        eased < 1
          ? buildTrailHead(join.previous, flight, size, params, pitch)
          : null;
      if (old) head = easeHead(old, head, eased * eased * (3 - 2 * eased));
      else join.previous = null;
    }
    if (head) heads.push(head);
  }

  params.cache.aboveCeiling = aboveCeiling;
  for (const icao24 of params.cache.geometry.keys()) {
    if (!drawn.has(icao24)) params.cache.geometry.delete(icao24);
  }
  for (const icao24 of params.cache.joins.keys()) {
    if (!drawn.has(icao24)) params.cache.joins.delete(icao24);
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

  const id = (name: string) =>
    params.idSuffix ? `${name}-${params.idSuffix}` : name;
  return [
    new PathLayer<TrailBody>({
      ...glow,
      id: id("flight-trail-glow"),
      data: params.cache.bodies,
      getPath: (body) => body.path,
      getColor: (body) => body.colors,
    }),
    new PathLayer<TrailHead>({
      ...glow,
      id: id("flight-trail-head-glow"),
      data: heads,
      getPath: (head) => head.path,
      getColor: (head) => head.colors,
    }),
    new PathLayer<TrailBody>({
      ...shared,
      id: id("flight-trails"),
      data: params.cache.bodies,
      getPath: (body) => body.path,
      getColor: (body) => body.colors,
    }),
    new PathLayer<TrailHead>({
      ...shared,
      id: id("flight-trail-heads"),
      data: heads,
      getPath: (head) => head.path,
      getColor: (head) => head.colors,
    }),
  ];
}

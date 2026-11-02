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
 * Trails and their halo are see-through and write no depth. Where trails
 * cross or merge, or a path overlaps itself at a joint, each then blends
 * over the other the same way every frame, rather than winning or losing
 * each pixel by a hair of depth, which flickers as anything moves; and a
 * smoothed edge cannot cut into a trail drawn behind it. Aircraft are
 * drawn after them, over them.
 */
const NO_DEPTH_WRITE = { depthWriteEnabled: false };

/**
 * The join turns the trail onto the nose over this many half-lengths of
 * the model, and at least this many pixels, so it reads as one line...
 */
const JOIN_TURN_HALF_LENGTHS = 3;
const JOIN_TURN_PX = 48;
/**
 * ...and moves it onto the tail over at least that, and at least this many
 * times how far the aircraft sits off its trail, sideways or in height, so
 * the bend that takes it there stays under about 3°.
 */
const JOIN_LENGTH_PER_OFFSET = 36;
/** The join is drawn with a point about this many pixels apart... */
const JOIN_SPACING_PX = 1.5;
/**
 * ...and with at most this many. Only a join long on screen, zoomed in
 * where few aircraft are in view, needs that many.
 */
const JOIN_MAX_POINTS = 160;
/**
 * Of those, a point is drawn once the line has turned this far since the
 * last one, or run on this many pixels, so a straight piece strays from
 * the curve by at most about a twentieth of a pixel.
 */
const JOIN_KEEP_TURN_RAD = (0.75 * Math.PI) / 180;
const JOIN_KEEP_RUN_PX = 24;
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

function lerpVertex(a: TrailVertex, b: TrailVertex, u: number): TrailVertex {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

function lerpColor(a: Rgba, b: Rgba, u: number): Rgba {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
    a[3] + (b[3] - a[3]) * u,
  ];
}

/** Metres east, north and up. */
type Vec3 = [number, number, number];

/** A horizontal length; Math.hypot is several times slower. */
function planar(east: number, north: number): number {
  return Math.sqrt(east * east + north * north);
}

/** smootherstep: 0 at 0 and 1 at 1, flat to its second derivative at both. */
function smootherstep(x: number): number {
  return x * x * x * (x * (6 * x - 15) + 10);
}

/**
 * The trail as a smooth curve through the lead's vertices, measured by
 * horizontal distance along it. The lead is a curve sampled every few
 * hundred metres; read through a Catmull-Rom spline it stays round however
 * far the map is zoomed in. Points are in metres east and north of the
 * lead's first vertex, and metres up.
 */
type LeadCurve = {
  points: Vec3[];
  /** Horizontal distance from the lead's start to each vertex. */
  along: number[];
  colors: Rgba[];
  /** The lead's first vertex, and metres per degree of longitude there. */
  originLng: number;
  originLat: number;
  metersPerLng: number;
};

/** A lead changes only with a new sample, so its curve is worked out once. */
const leadCurves = new WeakMap<TrailLead, LeadCurve>();

function leadCurve(lead: TrailLead): LeadCurve {
  const known = leadCurves.get(lead);
  if (known) return known;
  const [originLng, originLat] = lead.path[0];
  const metersPerLng =
    METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180);
  const points = lead.path.map(
    ([lng, lat, z]): Vec3 => [
      (lng - originLng) * metersPerLng,
      (lat - originLat) * METERS_PER_DEGREE,
      z,
    ],
  );
  const along = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [a, b] = [points[index - 1], points[index]];
    along.push(along[index - 1] + planar(b[0] - a[0], b[1] - a[1]));
  }
  const curve = {
    points,
    along,
    colors: lead.colors,
    originLng,
    originLat,
    metersPerLng,
  };
  leadCurves.set(lead, curve);
  return curve;
}

/** The segment `distance` along the curve lies on, and how far along it. */
function segmentAt(curve: LeadCurve, distance: number): [number, number] {
  const { along } = curve;
  let index = 0;
  while (index < along.length - 2 && along[index + 1] < distance) index += 1;
  const span = along[index + 1] - along[index];
  return [index, span > 0 ? (distance - along[index]) / span : 0];
}

/**
 * Writes into `out` the point `t` of the way along segment `index`, on a
 * Catmull-Rom spline through the curve's points.
 */
function pointOn(curve: LeadCurve, index: number, t: number, out: Vec3): Vec3 {
  const { points } = curve;
  const b = points[index];
  const c = points[index + 1] ?? b;
  const a = points[index - 1];
  const d = points[index + 2];
  const t2 = t * t;
  const t3 = t2 * t;
  for (let i = 0; i < 3; i += 1) {
    // Past either end, the spline runs on in a straight line.
    const ai = a ? a[i] : 2 * b[i] - c[i];
    const di = d ? d[i] : 2 * c[i] - b[i];
    out[i] =
      0.5 *
      (2 * b[i] +
        (c[i] - ai) * t +
        (2 * ai - 5 * b[i] + 4 * c[i] - di) * t2 +
        (3 * b[i] - ai - 3 * c[i] + di) * t3);
  }
  return out;
}

/** The curve's point, and its direction per horizontal metre, at a distance. */
function curveAt(curve: LeadCurve, distance: number): [Vec3, Vec3] {
  const { points, along } = curve;
  const [index, t] = segmentAt(curve, distance);
  const b = points[index];
  const c = points[index + 1] ?? b;
  const a = points[index - 1] ?? (b.map((v, i) => 2 * v - c[i]) as Vec3);
  const d = points[index + 2] ?? (c.map((v, i) => 2 * v - b[i]) as Vec3);
  const t2 = t * t;
  const position = pointOn(curve, index, t, [0, 0, 0]);
  const span = along[index + 1] - along[index];
  const slope = [0, 1, 2].map(
    (i) =>
      (0.5 *
        (c[i] -
          a[i] +
          2 * (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t +
          3 * (3 * b[i] - a[i] - 3 * c[i] + d[i]) * t2)) /
      (span > 0 ? span : 1),
  ) as Vec3;
  return [position, perHorizontalMetre(slope)];
}

/** A direction scaled so that its horizontal part is one metre long. */
function perHorizontalMetre([east, north, up]: Vec3): Vec3 {
  const run = planar(east, north);
  return run > 0 ? [east / run, north / run, up / run] : [0, 0, 0];
}

/** How far along the lead the point nearest `target` lies, horizontally. */
function nearestAlong(curve: LeadCurve, [east, north]: Vec3): number {
  const { points, along } = curve;
  let best = Infinity;
  let bestAlong = along[along.length - 1];
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const [a, b] = [points[index], points[index + 1]];
    const runEast = b[0] - a[0];
    const runNorth = b[1] - a[1];
    const run = runEast * runEast + runNorth * runNorth;
    const t =
      run > 0
        ? Math.min(
            1,
            Math.max(
              0,
              ((east - a[0]) * runEast + (north - a[1]) * runNorth) / run,
            ),
          )
        : 0;
    const gap = planar(a[0] + runEast * t - east, a[1] + runNorth * t - north);
    // Nearer the lead's end wins a tie, so the join keeps to the newest pass.
    if (gap < best - 1e-9) {
      best = gap;
      bestAlong = along[index] + (along[index + 1] - along[index]) * t;
    }
  }
  return bestAlong;
}

/**
 * The newest stretch of trail, bent smoothly onto the aircraft's tail,
 * rebuilt every frame as the aircraft moves.
 *
 * The trail is kept as it is up to a point behind the aircraft. From there
 * it is bent, a little more each metre, until it ends exactly at the tail,
 * pointing along the fuselage as the model is drawn, at its heading and
 * pitch. The bend starts with no change in direction or curvature, and
 * ends with none either, so the line leaves the trail without a seam and
 * enters the tail dead straight, whatever the model's size, crab or climb.
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
  const curve = leadCurve(lead);
  const { originLng, originLat, metersPerLng } = curve;
  const toVertex = ([east, north, z]: Vec3): TrailVertex => [
    originLng + east / metersPerLng,
    originLat + north / METERS_PER_DEGREE,
    z,
  ];
  // The aircraft, in the lead's own metres.
  const centreEast =
    (snapLngToReference(flight.longitude, originLng) - originLng) *
    metersPerLng;
  const centreNorth = (lat - originLat) * METERS_PER_DEGREE;

  const track = flight.trueTrack;
  const last = curve.points[curve.points.length - 1];
  const lastEast = last[0] - centreEast;
  const lastNorth = last[1] - centreNorth;
  const lastDistance = planar(lastEast, lastNorth);
  const heading: [number, number] | null =
    track != null && Number.isFinite(track)
      ? [Math.sin((track * Math.PI) / 180), Math.cos((track * Math.PI) / 180)]
      : lastDistance > 0
        ? [-lastEast / lastDistance, -lastNorth / lastDistance]
        : null;
  if (!heading) return null;

  // One screen pixel, and the model's half-length on screen, in metres at
  // the aircraft's height.
  const pixel = metersPerPixel(options.zoom, lat) / size.magnification;
  const halfLength = size.tailShare * size.footprintPx * pixel;
  // A pitched model's tail sits nearer, and lower when climbing or higher
  // when descending, than a level one's. The nose's direction is kept per
  // horizontal metre, as the trail's is.
  const climb = (-pitchDegrees * Math.PI) / 180;
  const nose: Vec3 = [heading[0], heading[1], Math.tan(climb)];
  const altitude = flight.onGround ? 0 : flight.baroAltitude;
  const centreZ = aircraftElevationMeters(
    altitude,
    options.altitudeDisplayMode,
  );
  const tail: Vec3 = [
    centreEast - heading[0] * halfLength * Math.cos(climb),
    centreNorth - heading[1] * halfLength * Math.cos(climb),
    centreZ - halfLength * Math.sin(climb),
  ];

  const base = options.altColors
    ? altitudeToColor(altitude)
    : options.defaultColor;
  const [r, g, b] = aircraftColor(base, flight);
  const endColor: Rgba = [r, g, b, lead.headAlpha];

  // Where the trail passes nearest the tail, and how far the tail sits from
  // there. The lead runs on to the newest sample, so this is usually right
  // beside the aircraft.
  const nearest = nearestAlong(curve, tail);
  const [onTrail, trailward] = curveAt(curve, nearest);
  const offset = tail.map((v, i) => v - onTrail[i]) as Vec3;
  // How far off the trail's own line the tail sits, sideways or in height;
  // along the trail, the bend only stretches it.
  const ahead = offset[0] * trailward[0] + offset[1] * trailward[1];
  const aside = Math.hypot(
    offset[0] - trailward[0] * ahead,
    offset[1] - trailward[1] * ahead,
    offset[2] - trailward[2] * ahead,
  );
  // Turning onto the nose stays close behind the aircraft, so it never
  // reaches back far enough to be disturbed when a new sample moves where
  // the cached trail ends; moving onto the tail reaches back only as far as
  // the aircraft's offset needs.
  const turnLength = Math.min(
    nearest,
    Math.max(JOIN_TURN_HALF_LENGTHS * halfLength, JOIN_TURN_PX * pixel),
  );
  const length = Math.min(
    nearest,
    Math.max(turnLength, JOIN_LENGTH_PER_OFFSET * aside),
  );
  const spacing = JOIN_SPACING_PX * pixel;

  const path: TrailVertex[] = [];
  const colors: Rgba[] = [];
  let kept: Vec3 | null = null;
  const keep = (point: Vec3, color: Rgba, always = false) => {
    // Points under a pixel apart only add joints that blend twice into
    // bright specks; the tail is always kept.
    if (
      !always &&
      kept &&
      Math.sqrt(
        (point[0] - kept[0]) ** 2 +
          (point[1] - kept[1]) ** 2 +
          (point[2] - kept[2]) ** 2,
      ) < pixel
    ) {
      return;
    }
    kept = point;
    path.push(toVertex(point));
    colors.push(color);
  };

  // The lead is drawn as it is up to where the bend begins.
  const bendFrom = nearest - length;
  for (let index = 0; index < curve.points.length; index += 1) {
    if (curve.along[index] >= bendFrom - 1e-6) break;
    path.push(lead.path[index]);
    colors.push(lead.colors[index]);
    kept = curve.points[index];
  }

  if (!(length > spacing)) {
    // The aircraft covers the whole lead, or the lead is a single point:
    // run straight from where the trail ends into the tail.
    keep(curve.points[0], curve.colors[0], true);
    keep(tail, endColor, true);
    return path.length >= 2 ? { icao24: flight.icao24, path, colors } : null;
  }

  // Each point of the bend is the trail's point `back` metres behind the
  // nearest one, moved part of the way to the tail and turned part of the
  // way to the nose. Both shares fall from all at the tail to nothing,
  // each over its own length, with no change of slope or curvature at
  // either end; the turn's share is what lets the line arrive along the
  // nose.
  const turnEast = trailward[0] - nose[0];
  const turnNorth = trailward[1] - nose[1];
  const turnUp = trailward[2] - nose[2];
  // Worked out every 1.5 px or so: densely where the line turns onto the
  // nose, and over the rest of the bend as finely as the budget allows.
  const backs: number[] = [];
  const reach = length - turnLength;
  const farSteps =
    reach > 0
      ? Math.min(
          JOIN_MAX_POINTS / 2,
          Math.ceil((reach + Math.hypot(...offset)) / spacing),
        )
      : 0;
  for (let step = 0; step < farSteps; step += 1) {
    backs.push(length - (reach * step) / farSteps);
  }
  const nearSteps = Math.min(
    JOIN_MAX_POINTS / 2,
    Math.max(4, Math.ceil((turnLength + Math.hypot(...offset)) / spacing)),
  );
  for (let step = 0; step <= nearSteps; step += 1) {
    backs.push(turnLength * (1 - step / nearSteps));
  }
  const onCurve: Vec3 = [0, 0, 0];
  const { along } = curve;
  const lastSegment = Math.max(0, along.length - 2);
  let segment = 0;
  // The bend is worked out finely but drawn only where it turns: a point
  // is kept once the line has turned a little since the last one, or run
  // on a long way, so each straight piece strays from the curve by a
  // small fraction of a pixel.
  let previousEast = 0;
  let previousNorth = 0;
  let previousUp = 0;
  let stepEast = 0;
  let stepNorth = 0;
  let stepUp = 0;
  let stepRun = 0;
  let turnedSinceKept = 0;
  let runSinceKept = 0;
  const keepRun = JOIN_KEEP_RUN_PX * pixel;
  for (let step = 0; step < backs.length; step += 1) {
    const share = length > 0 ? backs[step] / length : 0;
    const distance = nearest - backs[step];
    while (segment < lastSegment && along[segment + 1] < distance) {
      segment += 1;
    }
    const span = along[segment + 1] - along[segment];
    const t = span > 0 ? (distance - along[segment]) / span : 0;
    pointOn(curve, segment, t, onCurve);
    const moved = 1 - smootherstep(share);
    const turnShare = (share * length) / turnLength;
    const rest = 1 - turnShare;
    const turned =
      turnShare < 1
        ? turnLength * turnShare * rest * rest * rest * (1 + 3 * turnShare)
        : 0;
    const east = onCurve[0] + moved * offset[0] + turned * turnEast;
    const north = onCurve[1] + moved * offset[1] + turned * turnNorth;
    const up = onCurve[2] + moved * offset[2] + turned * turnUp;
    const last = step === backs.length - 1;
    if (step > 0) {
      // Climbs and descents bend the line on a tilted map as much as turns
      // do, so the bend is measured in three dimensions.
      const runEast = east - previousEast;
      const runNorth = north - previousNorth;
      const runUp = up - previousUp;
      const run = Math.sqrt(
        runEast * runEast + runNorth * runNorth + runUp * runUp,
      );
      if (run > 0) {
        if (stepRun > 0) {
          // The sine of the turn, which for turns this small is the turn;
          // a turn back on itself counts as a large one.
          const crossEast = stepNorth * runUp - stepUp * runNorth;
          const crossNorth = stepUp * runEast - stepEast * runUp;
          const crossUp = stepEast * runNorth - stepNorth * runEast;
          const ahead =
            stepEast * runEast + stepNorth * runNorth + stepUp * runUp;
          turnedSinceKept +=
            ahead < 0
              ? Math.PI / 2
              : Math.sqrt(
                  crossEast * crossEast +
                    crossNorth * crossNorth +
                    crossUp * crossUp,
                ) /
                (stepRun * run);
        }
        runSinceKept += run;
        stepEast = runEast;
        stepNorth = runNorth;
        stepUp = runUp;
        stepRun = run;
      }
    }
    previousEast = east;
    previousNorth = north;
    previousUp = up;
    if (
      step === 0 ||
      last ||
      turnedSinceKept >= JOIN_KEEP_TURN_RAD ||
      runSinceKept >= keepRun
    ) {
      const trailColor = lerpColor(
        curve.colors[segment],
        curve.colors[segment + 1] ?? curve.colors[segment],
        t,
      );
      const before = path.length;
      keep([east, north, up], lerpColor(trailColor, endColor, moved), last);
      if (path.length > before) {
        turnedSinceKept = 0;
        runSinceKept = 0;
      }
    }
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
    const oldColor = lerpColor(
      from.colors[segment + 1],
      from.colors[segment],
      u,
    );
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
    const join = joinFor(
      params.cache.joins,
      flight.icao24,
      geometry.lead,
      params.now,
    );
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
    parameters: NO_DEPTH_WRITE,
  };
  // The lines smooth their own edges, so a thin trail does not crawl in
  // steps as it moves.
  const line = { ...shared, antialiasing: true };
  // The halo reuses the trails' own data, so it costs no extra geometry,
  // and fades out towards its edges. Hidden, it stays in the list so deck
  // keeps its buffers for zooming back in.
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
      ...line,
      id: id("flight-trails"),
      data: params.cache.bodies,
      getPath: (body) => body.path,
      getColor: (body) => body.colors,
    }),
    new PathLayer<TrailHead>({
      ...line,
      id: id("flight-trail-heads"),
      data: heads,
      getPath: (head) => head.path,
      getColor: (head) => head.colors,
    }),
  ];
}

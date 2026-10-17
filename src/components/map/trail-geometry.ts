import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { altitudeToColor } from "@/lib/flight-utils";
import { snapLngToReference } from "@/lib/geo";
import type { FlightState } from "@/lib/opensky";
import type { TrailSample, TrailTrack } from "@/lib/trails/types";

import { aircraftColor } from "./aircraft-appearance";
import { trailElevationMeters } from "./altitude-projection";
import { horizontalDistanceFromLngLat } from "./flight-math";

export type Rgba = [number, number, number, number];
export type TrailVertex = [lng: number, lat: number, z: number];

/** Opacity of the newer half of a trail; the older half fades out. */
export const TRAIL_ALPHA = 210;
/** Shortest fade, so a trail that has only just started does not start hard. */
const MIN_FADE_MS = 60_000;
/** Share of a full history that fades, so most of a long route stays solid. */
const HISTORY_FADE_SHARE = 0.15;
/** A lone altitude this far from both neighbours, which agree, is a glitch. */
const ALTITUDE_GLITCH_METERS = 300;
/** Turns gentler than this are drawn straight, so noise cannot wobble them. */
const STRAIGHT_TURN_RAD = (2 * Math.PI) / 180;
const CURVE_STEP_METERS = 250;
const MAX_CURVE_STEPS = 16;
/**
 * How much of the newest trail the head redraws every frame, so the head
 * can start far enough behind the aircraft to meet its tail straight on.
 */
const LEAD_MS = 20_000;

type CurvePoint = { lng: number; lat: number; alt: number | null; t: number };

export type TrailBody = {
  icao24: string;
  path: TrailVertex[];
  colors: Rgba[];
};

/**
 * The newest stretch of trail, up to the second-newest sample. The head
 * redraws it every frame, cut short where the aircraft has caught up.
 */
export type TrailLead = {
  path: TrailVertex[];
  colors: Rgba[];
  /** Unit direction of the trail arriving at each vertex, as [east, north]. */
  tangents: Array<[number, number] | null>;
  /** Opacity at the newest sample, which the aircraft is flying towards. */
  headAlpha: number;
};

export type TrailGeometry = {
  bodies: TrailBody[];
  lead: TrailLead | null;
};

/** The aircraft fields its colour depends on. */
export type TrailAppearance = Pick<
  FlightState,
  "category" | "dbFlags" | "emergencyStatus"
>;

export type TrailGeometryOptions = {
  /** How much of the trail to show; null shows all of it. */
  windowMs: number | null;
  altitudeDisplayMode: AltitudeDisplayMode;
  altColors: boolean;
  defaultColor: Rgba;
  appearance: TrailAppearance;
};

type Curves = {
  curves: CurvePoint[][];
  lead: CurvePoint[];
  /** The point before the lead, for the direction the lead starts in. */
  beforeLead: CurvePoint | null;
  fadeStart: number;
  fadeSpan: number;
  tEnd: number;
};

type CacheEntry = {
  revision: number;
  windowMs: number | null;
  curves: Curves;
  projectionKey: string;
  geometry: TrailGeometry;
};

export type TrailGeometryCache = Map<string, CacheEntry>;

const EMPTY_GEOMETRY: TrailGeometry = { bodies: [], lead: null };

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Centripetal knot spacing: the square root of the scaled distance. */
function knotSpacing(a: CurvePoint, b: CurvePoint): number {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const distance = Math.hypot((b.lng - a.lng) * cosLat, b.lat - a.lat);
  return Math.sqrt(Math.max(distance, 1e-12));
}

function safeBlend(
  a: number,
  b: number,
  tA: number,
  tB: number,
  t: number,
): number {
  const span = tB - tA;
  return Math.abs(span) < 1e-12 ? (a + b) / 2 : a + ((b - a) * (t - tA)) / span;
}

/**
 * A point on the centripetal Catmull-Rom segment between p1 and p2. The
 * centripetal form never forms loops or cusps, unlike the uniform one.
 */
function catmullRom(
  p0: CurvePoint,
  p1: CurvePoint,
  p2: CurvePoint,
  p3: CurvePoint,
  u: number,
): [number, number] {
  const t1 = knotSpacing(p0, p1);
  const t2 = t1 + knotSpacing(p1, p2);
  const t3 = t2 + knotSpacing(p2, p3);
  const t = t1 + (t2 - t1) * u;

  // Barry and Goldman's pyramid over the four control values.
  const blend = (v0: number, v1: number, v2: number, v3: number) => {
    const a1 = safeBlend(v0, v1, 0, t1, t);
    const a2 = safeBlend(v1, v2, t1, t2, t);
    const a3 = safeBlend(v2, v3, t2, t3, t);
    const value = safeBlend(
      safeBlend(a1, a2, 0, t2, t),
      safeBlend(a2, a3, t1, t3, t),
      t1,
      t2,
      t,
    );
    return Number.isFinite(value) ? value : lerp(v1, v2, u);
  };

  return [
    blend(p0.lng, p1.lng, p2.lng, p3.lng),
    blend(p0.lat, p1.lat, p2.lat, p3.lat),
  ];
}

function mirror(anchor: CurvePoint, other: CurvePoint): CurvePoint {
  return {
    lng: 2 * anchor.lng - other.lng,
    lat: 2 * anchor.lat - other.lat,
    alt: anchor.alt,
    t: anchor.t,
  };
}

function turnRadians(a: CurvePoint, b: CurvePoint, c: CurvePoint): number {
  const cosLat = Math.cos(b.lat * (Math.PI / 180));
  const before = Math.atan2(b.lat - a.lat, (b.lng - a.lng) * cosLat);
  const after = Math.atan2(c.lat - b.lat, (c.lng - b.lng) * cosLat);
  const turn = Math.abs(after - before);
  return turn > Math.PI ? 2 * Math.PI - turn : turn;
}

/** Altitudes with gaps filled from neighbours and lone glitches removed. */
function cleanAltitudes(samples: TrailSample[]): Array<number | null> {
  const altitudes = samples.map((sample) => sample.alt);

  let known: number | null = null;
  for (let index = 0; index < altitudes.length; index += 1) {
    if (altitudes[index] == null) altitudes[index] = known;
    else known = altitudes[index];
  }
  const first = altitudes.find((altitude) => altitude != null) ?? null;
  for (
    let index = 0;
    index < altitudes.length && altitudes[index] == null;
    index += 1
  ) {
    altitudes[index] = first;
  }

  for (let index = 1; index < altitudes.length - 1; index += 1) {
    const before = altitudes[index - 1];
    const value = altitudes[index];
    const after = altitudes[index + 1];
    if (before == null || value == null || after == null) continue;
    if (
      Math.abs(before - after) < ALTITUDE_GLITCH_METERS &&
      Math.abs(value - before) > ALTITUDE_GLITCH_METERS &&
      Math.abs(value - after) > ALTITUDE_GLITCH_METERS
    ) {
      altitudes[index] = (before + after) / 2;
    }
  }
  return altitudes;
}

/**
 * The curve through samples[0..lastIndex]. Samples after lastIndex only
 * shape the final segment, and each segment depends on its four nearest
 * samples alone, so a new sample never moves older parts of the trail.
 */
function curveThrough(samples: TrailSample[], lastIndex: number): CurvePoint[] {
  const altitudes = cleanAltitudes(samples);
  const points: CurvePoint[] = [];
  let referenceLng = samples[0].lng;
  for (const [index, sample] of samples.entries()) {
    referenceLng = snapLngToReference(sample.lng, referenceLng);
    points.push({
      lng: referenceLng,
      lat: sample.lat,
      alt: altitudes[index],
      t: sample.t,
    });
  }

  const curve: CurvePoint[] = [points[0]];
  for (let index = 0; index < lastIndex; index += 1) {
    const p1 = points[index];
    const p2 = points[index + 1];
    const p0 = points[index - 1] ?? mirror(p1, p2);
    const p3 = points[index + 2] ?? mirror(p2, p1);

    const turn = Math.max(turnRadians(p0, p1, p2), turnRadians(p1, p2, p3));
    const steps =
      turn < STRAIGHT_TURN_RAD
        ? 1
        : Math.min(
            MAX_CURVE_STEPS,
            Math.max(
              2,
              Math.ceil(
                horizontalDistanceFromLngLat(p1.lng, p1.lat, p2.lng, p2.lat) /
                  CURVE_STEP_METERS,
              ),
            ),
          );

    for (let step = 1; step < steps; step += 1) {
      const u = step / steps;
      const [lng, lat] = catmullRom(p0, p1, p2, p3, u);
      curve.push({
        lng,
        lat,
        alt:
          p1.alt != null && p2.alt != null ? lerp(p1.alt, p2.alt, u) : p1.alt,
        t: lerp(p1.t, p2.t, u),
      });
    }
    curve.push(p2);
  }
  return curve;
}

/** Drops the part of a curve older than tStart, ending exactly at tStart. */
function cutBefore(curve: CurvePoint[], tStart: number): CurvePoint[] {
  if (curve.length === 0 || curve[0].t >= tStart) return curve;

  const first = curve.findIndex((point) => point.t >= tStart);
  if (first < 0) return [];
  if (curve[first].t === tStart) return curve.slice(first);

  const before = curve[first - 1];
  const after = curve[first];
  const u = (tStart - before.t) / (after.t - before.t);
  return [
    {
      lng: lerp(before.lng, after.lng, u),
      lat: lerp(before.lat, after.lat, u),
      alt:
        before.alt != null && after.alt != null
          ? lerp(before.alt, after.alt, u)
          : after.alt,
      t: tStart,
    },
    ...curve.slice(first),
  ];
}

function buildCurves(track: TrailTrack, windowMs: number | null): Curves {
  const lastPart = track.parts[track.parts.length - 1];
  const tEnd = lastPart?.[lastPart.length - 1]?.t ?? 0;
  const tStart = windowMs == null ? -Infinity : tEnd - windowMs;
  const curves: CurvePoint[][] = [];
  let lead: CurvePoint[] = [];
  let beforeLead: CurvePoint | null = null;

  for (const [index, part] of track.parts.entries()) {
    if (part[part.length - 1].t < tStart) continue;

    // The aircraft is still flying from the second-newest sample to the
    // newest, so the newest part stops there and the head draws the rest.
    const isNewest = index === track.parts.length - 1;
    const lastIndex = isNewest ? part.length - 2 : part.length - 1;
    if (lastIndex < 0) continue;

    let curve = cutBefore(curveThrough(part, lastIndex), tStart);
    if (isNewest && curve.length > 0) {
      let leadFrom = Math.max(0, lastIndex - 1);
      while (leadFrom > 0 && part[leadFrom].t > part[lastIndex].t - LEAD_MS) {
        leadFrom -= 1;
      }
      const split = curve.findIndex((point) => point.t >= part[leadFrom].t);
      lead = curve.slice(split);
      beforeLead = curve[split - 1] ?? null;
      curve = curve.slice(0, split + 1);
    }
    if (curve.length >= 2) curves.push(curve);
  }

  const fadeStart = curves[0]?.[0]?.t ?? lead[0]?.t ?? tEnd;
  const fadeShare = windowMs == null ? HISTORY_FADE_SHARE : 0.5;
  return {
    curves,
    lead,
    beforeLead,
    fadeStart,
    fadeSpan: Math.max(MIN_FADE_MS, (tEnd - fadeStart) * fadeShare),
    tEnd,
  };
}

function directionBetween(
  from: CurvePoint,
  to: CurvePoint,
): [number, number] | null {
  const east =
    (to.lng - from.lng) * Math.cos(((from.lat + to.lat) / 2) * (Math.PI / 180));
  const north = to.lat - from.lat;
  const length = Math.hypot(east, north);
  return length > 0 ? [east / length, north / length] : null;
}

function project(
  icao24: string,
  { curves, lead, beforeLead, fadeStart, fadeSpan, tEnd }: Curves,
  options: TrailGeometryOptions,
): TrailGeometry {
  const alphaAt = (t: number) =>
    Math.round(
      TRAIL_ALPHA * Math.min(1, Math.max(0, (t - fadeStart) / fadeSpan)),
    );
  const toVertex = (point: CurvePoint): TrailVertex => [
    point.lng,
    point.lat,
    trailElevationMeters(point.alt, options.altitudeDisplayMode),
  ];
  const toColor = (point: CurvePoint): Rgba => {
    const base = options.altColors
      ? altitudeToColor(point.alt)
      : options.defaultColor;
    const [r, g, b] = aircraftColor(base, options.appearance);
    return [r, g, b, alphaAt(point.t)];
  };

  return {
    bodies: curves.map((curve) => ({
      icao24,
      path: curve.map(toVertex),
      colors: curve.map(toColor),
    })),
    lead:
      lead.length > 0
        ? {
            path: lead.map(toVertex),
            colors: lead.map(toColor),
            tangents: lead.map((point, index) => {
              const from = index > 0 ? lead[index - 1] : beforeLead;
              return from ? directionBetween(from, point) : null;
            }),
            headAlpha: alphaAt(tEnd),
          }
        : null,
  };
}

/**
 * The drawable trail of one aircraft. Smoothing reruns only when the track
 * changes, and projection only when the altitude mode or colours change.
 */
export function getTrailGeometry(
  cache: TrailGeometryCache,
  track: TrailTrack,
  options: TrailGeometryOptions,
): TrailGeometry {
  let entry = cache.get(track.icao24);
  if (
    !entry ||
    entry.revision !== track.revision ||
    entry.windowMs !== options.windowMs
  ) {
    entry = {
      revision: track.revision,
      windowMs: options.windowMs,
      curves: buildCurves(track, options.windowMs),
      projectionKey: "",
      geometry: EMPTY_GEOMETRY,
    };
    cache.set(track.icao24, entry);
  }

  const { category, dbFlags, emergencyStatus } = options.appearance;
  const projectionKey = [
    options.altitudeDisplayMode,
    options.altColors,
    options.defaultColor.join(","),
    category,
    dbFlags,
    emergencyStatus,
  ].join("|");
  if (entry.projectionKey !== projectionKey) {
    entry.geometry = project(track.icao24, entry.curves, options);
    entry.projectionKey = projectionKey;
  }
  return entry.geometry;
}

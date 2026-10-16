import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { altitudeToColor } from "@/lib/flight-utils";
import { snapLngToReference } from "@/lib/geo";
import type { TrailSample, TrailTrack } from "@/lib/trails/types";

import { projectTrailElevationMeters } from "./altitude-projection";
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

type CurvePoint = { lng: number; lat: number; alt: number | null; t: number };

export type TrailBody = {
  icao24: string;
  path: TrailVertex[];
  colors: Rgba[];
};

/** The second-newest sample, where the per-frame head starts. */
export type TrailHeadAnchor = {
  vertex: TrailVertex;
  color: Rgba;
  /** Opacity at the newest sample, which the aircraft is flying towards. */
  headAlpha: number;
};

export type TrailGeometry = {
  bodies: TrailBody[];
  anchor: TrailHeadAnchor | null;
};

export type TrailGeometryOptions = {
  /** How much of the trail to show; null shows all of it. */
  windowMs: number | null;
  altitudeDisplayMode: AltitudeDisplayMode;
  elevScale: number;
  altColors: boolean;
  defaultColor: Rgba;
};

type Curves = {
  curves: CurvePoint[][];
  anchor: CurvePoint | null;
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

const EMPTY_GEOMETRY: TrailGeometry = { bodies: [], anchor: null };

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
  let anchor: CurvePoint | null = null;

  for (const [index, part] of track.parts.entries()) {
    if (part[part.length - 1].t < tStart) continue;

    // The aircraft is still flying from the second-newest sample to the
    // newest, so the newest part stops there and the head draws the rest.
    const isNewest = index === track.parts.length - 1;
    const lastIndex = isNewest ? part.length - 2 : part.length - 1;
    if (lastIndex < 0) continue;

    const curve = cutBefore(curveThrough(part, lastIndex), tStart);
    if (isNewest) anchor = curve[curve.length - 1] ?? null;
    if (curve.length >= 2) curves.push(curve);
  }

  const fadeStart = curves[0]?.[0]?.t ?? anchor?.t ?? tEnd;
  const fadeShare = windowMs == null ? HISTORY_FADE_SHARE : 0.5;
  return {
    curves,
    anchor,
    fadeStart,
    fadeSpan: Math.max(MIN_FADE_MS, (tEnd - fadeStart) * fadeShare),
    tEnd,
  };
}

function project(
  icao24: string,
  { curves, anchor, fadeStart, fadeSpan, tEnd }: Curves,
  options: TrailGeometryOptions,
): TrailGeometry {
  const alphaAt = (t: number) =>
    Math.round(
      TRAIL_ALPHA * Math.min(1, Math.max(0, (t - fadeStart) / fadeSpan)),
    );
  const toVertex = (point: CurvePoint): TrailVertex => [
    point.lng,
    point.lat,
    Math.max(
      0,
      projectTrailElevationMeters(point.alt, options.altitudeDisplayMode) *
        options.elevScale,
    ),
  ];
  const toColor = (point: CurvePoint): Rgba => {
    const [r, g, b] = options.altColors
      ? altitudeToColor(point.alt)
      : options.defaultColor;
    return [r, g, b, alphaAt(point.t)];
  };

  return {
    bodies: curves.map((curve) => ({
      icao24,
      path: curve.map(toVertex),
      colors: curve.map(toColor),
    })),
    anchor: anchor
      ? {
          vertex: toVertex(anchor),
          color: toColor(anchor),
          headAlpha: alphaAt(tEnd),
        }
      : null,
  };
}

/**
 * The drawable trail of one aircraft. Smoothing reruns only when the track
 * changes, and projection only when the view or colours change.
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

  // Two decimals keeps zoom-driven elevation changes from reprojecting
  // every trail on every frame.
  const projectionKey = [
    options.altitudeDisplayMode,
    options.elevScale.toFixed(2),
    options.altColors,
    options.defaultColor.join(","),
  ].join("|");
  if (entry.projectionKey !== projectionKey) {
    entry.geometry = project(track.icao24, entry.curves, {
      ...options,
      elevScale: Number(options.elevScale.toFixed(2)),
    });
    entry.projectionKey = projectionKey;
  }
  return entry.geometry;
}

import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { altitudeToColor as aircraftAltitudeToColor } from "@/lib/flight-utils";

import { unprojectTrailElevationToRawAltitude } from "./altitude-projection";
import { horizontalDistanceFromLngLat } from "./flight-math";

export type TrailRenderSegment = {
  id: string;
  icao24: string;
  kind: "body" | "connector";
  path: [number, number, number][];
  color: [number, number, number, number];
};

export function trimTrailBodyForConnector(
  points: [number, number, number][],
  trimMeters: number,
): [number, number, number][] {
  if (points.length < 2 || trimMeters <= 0) {
    return points;
  }

  const trimmed = points.map((point) => [...point] as [number, number, number]);
  let remainingMeters = trimMeters;

  while (trimmed.length >= 2 && remainingMeters > 0) {
    const end = trimmed[trimmed.length - 1];
    const start = trimmed[trimmed.length - 2];
    const segmentMeters = horizontalDistanceFromLngLat(
      start[0],
      start[1],
      end[0],
      end[1],
    );

    if (segmentMeters <= 1e-6) {
      trimmed.pop();
      continue;
    }

    if (segmentMeters > remainingMeters) {
      const t = Math.max(0, (segmentMeters - remainingMeters) / segmentMeters);
      trimmed[trimmed.length - 1] = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
      ];
      return trimmed;
    }

    trimmed.pop();
    remainingMeters -= segmentMeters;
  }

  return trimmed;
}

const TRAIL_TAIL_ALPHA = 220;
const CONNECTOR_HEAD_ALPHA = 168;
function scaleTrailColor(
  color: [number, number, number, number],
  factor: number,
): [number, number, number] {
  return [
    Math.min(255, Math.round(color[0] * factor)),
    Math.min(255, Math.round(color[1] * factor)),
    Math.min(255, Math.round(color[2] * factor)),
  ];
}

function blendRgba(
  start: [number, number, number, number],
  end: [number, number, number, number],
): [number, number, number, number] {
  return [
    Math.round((start[0] + end[0]) * 0.5),
    Math.round((start[1] + end[1]) * 0.5),
    Math.round((start[2] + end[2]) * 0.5),
    Math.round((start[3] + end[3]) * 0.5),
  ];
}

export function trailAltitudeToColor(
  altitude: number | null,
): [number, number, number, number] {
  return aircraftAltitudeToColor(altitude);
}

/** Context needed to un-project trail Z values back to raw altitude for coloring. */
export type TrailElevationContext = {
  elevScale: number;
  altitudeDisplayMode: AltitudeDisplayMode;
};

function trailPointToRawAltitude(
  projectedZ: number,
  ctx: TrailElevationContext | undefined,
): number | null {
  if (ctx) {
    return unprojectTrailElevationToRawAltitude(
      projectedZ,
      ctx.elevScale,
      ctx.altitudeDisplayMode,
    );
  }
  return projectedZ;
}

export function buildTrailBodyGradientColors(
  points: [number, number, number][],
  altColors: boolean,
  defaultColor: [number, number, number, number],
  elevCtx?: TrailElevationContext,
): [number, number, number, number][] {
  const len = points.length;

  return points.map((point, i) => {
    const tVal = len > 1 ? i / (len - 1) : 1;
    const fade = 0.15 + 0.85 * Math.pow(tVal, 1.35);
    const rawAlt = trailPointToRawAltitude(point[2], elevCtx);
    const base = altColors ? trailAltitudeToColor(rawAlt) : defaultColor;
    const brightness = altColors ? 0.72 + 0.28 * Math.pow(tVal, 1.1) : 1;
    const [r, g, b] = scaleTrailColor(base, brightness);
    const alpha = Math.round(55 + fade * 165);

    return [r, g, b, alpha];
  });
}

export function buildConnectorGradientColors(
  points: [number, number, number][],
  altColors: boolean,
  defaultColor: [number, number, number, number],
  elevCtx?: TrailElevationContext,
): [number, number, number, number][] {
  const len = points.length;

  return points.map((point, index) => {
    const tVal = len > 1 ? index / (len - 1) : 1;
    const eased = Math.pow(tVal, 1.1);
    const rawAlt = trailPointToRawAltitude(point[2], elevCtx);
    const base = altColors ? trailAltitudeToColor(rawAlt) : defaultColor;
    const brightness = altColors ? 0.94 - 0.12 * eased : 1;
    const [r, g, b] = scaleTrailColor(base, brightness);
    const alpha = Math.round(
      TRAIL_TAIL_ALPHA + (CONNECTOR_HEAD_ALPHA - TRAIL_TAIL_ALPHA) * eased,
    );

    return [r, g, b, alpha];
  });
}

export function buildTrailRenderSegments(input: {
  icao24: string;
  points: [number, number, number][];
  kind: "body" | "connector";
  altColors: boolean;
  defaultColor: [number, number, number, number];
  elevCtx?: TrailElevationContext;
}): TrailRenderSegment[] {
  const gradientColors =
    input.kind === "connector"
      ? buildConnectorGradientColors(
          input.points,
          input.altColors,
          input.defaultColor,
          input.elevCtx,
        )
      : buildTrailBodyGradientColors(
          input.points,
          input.altColors,
          input.defaultColor,
          input.elevCtx,
        );

  const segments: TrailRenderSegment[] = [];
  for (let index = 0; index < input.points.length - 1; index += 1) {
    const start = input.points[index];
    const end = input.points[index + 1];
    if (
      ![start[0], start[1], start[2], end[0], end[1], end[2]].every(
        Number.isFinite,
      )
    ) {
      continue;
    }

    segments.push({
      id: `${input.icao24}:${input.kind}:${index}`,
      icao24: input.icao24,
      kind: input.kind,
      path: [start, end],
      color: blendRgba(
        gradientColors[index] ??
          gradientColors[index + 1] ?? [255, 255, 255, 255],
        gradientColors[index + 1] ??
          gradientColors[index] ?? [255, 255, 255, 255],
      ),
    });
  }

  return segments;
}

import { roundSharpCorners3D } from "@/lib/trail-smoothing";

import type { ElevatedPoint } from "./flight-layer-constants";

const SIGNIFICANT_TURN_RAD = (20 * Math.PI) / 180;
const MIN_PRESERVE_PATH_TO_CHORD_RATIO = 1.18;
const MIN_PRESERVE_SPAN_DEG = 0.06;
const MIN_PRESERVE_SIGNED_TURN_RAD = (90 * Math.PI) / 180;
const MAX_TINY_CUSP_SPAN_DEG = 0.08;

function clonePoint(point: ElevatedPoint): ElevatedPoint {
  return [point[0], point[1], point[2]];
}

function normalizeTurn(value: number): number {
  let nextValue = value;
  if (nextValue > Math.PI) nextValue -= Math.PI * 2;
  if (nextValue < -Math.PI) nextValue += Math.PI * 2;
  return nextValue;
}

function segmentHeading(a: ElevatedPoint, b: ElevatedPoint): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

export function getCurveFootprintMetrics(points: ElevatedPoint[]) {
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  const avgLat =
    (latitudes.reduce((a, b) => a + b, 0) / latitudes.length) * (Math.PI / 180);
  const cosLat = Math.max(0.1, Math.cos(avgLat));
  const width = (Math.max(...longitudes) - Math.min(...longitudes)) * cosLat;
  const height = Math.max(...latitudes) - Math.min(...latitudes);
  const chord = Math.hypot(
    (points[points.length - 1][0] - points[0][0]) * cosLat,
    points[points.length - 1][1] - points[0][1],
  );
  const path = points
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum +
        Math.hypot(
          (point[0] - points[index][0]) * cosLat,
          point[1] - points[index][1],
        ),
      0,
    );

  return {
    maxSpan: Math.max(width, height),
    pathToChordRatio: path / Math.max(chord, 1e-6),
  };
}

function shouldPreserveTurnWindow(points: ElevatedPoint[]): boolean {
  if (points.length < 4) {
    return false;
  }

  let previousSign = 0;
  let significantTurns = 0;
  let sameDirectionTurns = 0;
  let signedTurnTotal = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const before = segmentHeading(points[index - 1], points[index]);
    const after = segmentHeading(points[index], points[index + 1]);
    const delta = normalizeTurn(after - before);

    if (Math.abs(delta) < SIGNIFICANT_TURN_RAD) {
      continue;
    }

    const sign = Math.sign(delta);
    if (sign === 0) {
      continue;
    }

    significantTurns += 1;
    signedTurnTotal += delta;

    if (previousSign !== 0) {
      if (sign !== previousSign) {
        return false;
      }
      sameDirectionTurns += 1;
    }

    previousSign = sign;
  }

  if (significantTurns < 2 || sameDirectionTurns < 1) {
    return false;
  }

  const metrics = getCurveFootprintMetrics(points);
  return (
    metrics.maxSpan >= MIN_PRESERVE_SPAN_DEG &&
    metrics.pathToChordRatio >= MIN_PRESERVE_PATH_TO_CHORD_RATIO &&
    Math.abs(signedTurnTotal) >= MIN_PRESERVE_SIGNED_TURN_RAD
  );
}

export function hasPreservedTurnWindow(points: ElevatedPoint[]): boolean {
  if (shouldPreserveTurnWindow(points)) {
    return true;
  }

  for (const size of [4, 5] as const) {
    if (points.length < size) {
      continue;
    }

    for (let start = 0; start <= points.length - size; start += 1) {
      if (shouldPreserveTurnWindow(points.slice(start, start + size))) {
        return true;
      }
    }
  }

  return false;
}

function isValidPoint(p: ElevatedPoint): boolean {
  return (
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])
  );
}

export function cleanupControlPointArtifacts(
  points: ElevatedPoint[],
): ElevatedPoint[] {
  const valid = points.filter(isValidPoint);
  if (valid.length < 5) {
    return valid.map(clonePoint);
  }

  const result = (
    valid.length <= 8 && hasPreservedTurnWindow(valid)
      ? roundSharpCorners3D(valid, 20)
      : valid
  ).map(clonePoint);

  for (let pass = 0; pass < 6; pass += 1) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 1; index < result.length - 2; index += 1) {
      const window = result.slice(
        Math.max(0, index - 1),
        Math.min(result.length, index + 3),
      );
      if (shouldPreserveTurnWindow(window)) {
        continue;
      }

      const prev = result[index - 1];
      const current = result[index];
      const next = result[index + 1];
      const following = result[index + 2];
      const dx = following[0] - prev[0];
      const dy = following[1] - prev[1];
      const lenSq = dx * dx + dy * dy;

      if (lenSq < 1e-10) {
        continue;
      }

      const currentProjection =
        ((current[0] - prev[0]) * dx + (current[1] - prev[1]) * dy) / lenSq;
      const nextProjection =
        ((next[0] - prev[0]) * dx + (next[1] - prev[1]) * dy) / lenSq;
      const currentCross =
        dx * (current[1] - prev[1]) - dy * (current[0] - prev[0]);
      const nextCross = dx * (next[1] - prev[1]) - dy * (next[0] - prev[0]);
      const direct = Math.sqrt(lenSq);
      const len1 = Math.hypot(current[0] - prev[0], current[1] - prev[1]);
      const len2 = Math.hypot(next[0] - current[0], next[1] - current[1]);
      const len3 = Math.hypot(following[0] - next[0], following[1] - next[1]);
      const detourRatio = (len1 + len2 + len3) / Math.max(direct, 1e-10);
      const alternatingSides = currentCross * nextCross < 0;
      const crossTrackRatio =
        Math.max(Math.abs(currentCross), Math.abs(nextCross)) /
        Math.max(direct, 1e-10);
      const backtracks = nextProjection < currentProjection - 0.03;

      const turn1 =
        Math.atan2(next[1] - current[1], next[0] - current[0]) -
        Math.atan2(current[1] - prev[1], current[0] - prev[0]);
      const turn2 =
        Math.atan2(following[1] - next[1], following[0] - next[0]) -
        Math.atan2(next[1] - current[1], next[0] - current[0]);
      const normalizedTurn1 = normalizeTurn(turn1);
      const normalizedTurn2 = normalizeTurn(turn2);
      const alternatingSharpTurns =
        normalizedTurn1 * normalizedTurn2 < 0 &&
        Math.abs(normalizedTurn1) > (75 * Math.PI) / 180 &&
        Math.abs(normalizedTurn2) > (75 * Math.PI) / 180;

      if (alternatingSharpTurns && detourRatio > 1.22) {
        const score =
          detourRatio + Math.abs(normalizedTurn1) + Math.abs(normalizedTurn2);

        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }

        continue;
      }

      if (
        backtracks &&
        detourRatio > 1.12 &&
        (alternatingSides || crossTrackRatio > 0.002)
      ) {
        const score = detourRatio + crossTrackRatio;

        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
    }

    if (bestIndex === -1) {
      break;
    }

    result.splice(bestIndex, 2);
  }

  return result;
}

export function cleanupDisplayCurve(points: ElevatedPoint[]): ElevatedPoint[] {
  const valid = points.filter(isValidPoint);
  if (valid.length < 4) {
    return valid.map(clonePoint);
  }

  const result = valid.map(clonePoint);

  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;

    for (let index = 1; index < result.length - 2; index += 1) {
      const window = result.slice(
        Math.max(0, index - 1),
        Math.min(result.length, index + 3),
      );
      if (shouldPreserveTurnWindow(window)) {
        continue;
      }

      const prev = result[index - 1];
      const current = result[index];
      const next = result[index + 1];
      const following = result[index + 2];

      const dx = following[0] - prev[0];
      const dy = following[1] - prev[1];
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-10) {
        continue;
      }

      const currentProjection =
        ((current[0] - prev[0]) * dx + (current[1] - prev[1]) * dy) / lenSq;
      const nextProjection =
        ((next[0] - prev[0]) * dx + (next[1] - prev[1]) * dy) / lenSq;
      const currentCross =
        dx * (current[1] - prev[1]) - dy * (current[0] - prev[0]);
      const nextCross = dx * (next[1] - prev[1]) - dy * (next[0] - prev[0]);

      const len1 = Math.hypot(current[0] - prev[0], current[1] - prev[1]);
      const len2 = Math.hypot(next[0] - current[0], next[1] - current[1]);
      const len3 = Math.hypot(following[0] - next[0], following[1] - next[1]);
      const direct = Math.sqrt(lenSq);
      const detourRatio = (len1 + len2 + len3) / Math.max(direct, 1e-10);
      const crossTrackRatio =
        Math.max(Math.abs(currentCross), Math.abs(nextCross)) /
        Math.max(direct, 1e-10);
      const backtracks = nextProjection < currentProjection - 0.02;
      const swingsAcross = currentCross * nextCross < 0;
      const maxSpan = getCurveFootprintMetrics(window).maxSpan;

      if (
        backtracks &&
        detourRatio > 1.08 &&
        maxSpan <= MAX_TINY_CUSP_SPAN_DEG &&
        (swingsAcross || crossTrackRatio > 0.0015)
      ) {
        result.splice(index, 2);
        changed = true;
        break;
      }
    }

    if (!changed) {
      break;
    }
  }

  return result;
}

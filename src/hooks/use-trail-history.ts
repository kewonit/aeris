"use client";

import { useState, useMemo } from "react";
import type { FlightState } from "@/lib/opensky";

type Position = [lng: number, lat: number];

export type TrailEntry = {
  icao24: string;
  path: Position[];
  baroAltitude: number | null;
};

const MAX_POINTS = 40;
const JUMP_THRESHOLD_DEG = 0.3;
export const SAMPLES_PER_SEGMENT = 8;
const HISTORICAL_BOOTSTRAP_POLLS = 3;
const HISTORICAL_BOOTSTRAP_STEP_SEC = 12;
const BOOTSTRAP_UPDATES = 3;

// Centripetal Catmull-Rom spline (Barry-Goldman algorithm, α = 0.5).
// Produces smooth C1 curves that pass through every control point.
function catmullRomSmooth(
  points: Position[],
  samplesPerSegment: number = SAMPLES_PER_SEGMENT,
): Position[] {
  if (points.length < 3) return [...points];

  const result: Position[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const d01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5) || 1e-6;
    const d12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5) || 1e-6;
    const d23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5) || 1e-6;

    const t0 = 0;
    const t1 = d01;
    const t2 = t1 + d12;
    const t3 = t2 + d23;

    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = t1 + (t2 - t1) * (s / samplesPerSegment);

      const a1x =
        ((t1 - t) / (t1 - t0)) * p0[0] + ((t - t0) / (t1 - t0)) * p1[0];
      const a1y =
        ((t1 - t) / (t1 - t0)) * p0[1] + ((t - t0) / (t1 - t0)) * p1[1];
      const a2x =
        ((t2 - t) / (t2 - t1)) * p1[0] + ((t - t1) / (t2 - t1)) * p2[0];
      const a2y =
        ((t2 - t) / (t2 - t1)) * p1[1] + ((t - t1) / (t2 - t1)) * p2[1];
      const a3x =
        ((t3 - t) / (t3 - t2)) * p2[0] + ((t - t2) / (t3 - t2)) * p3[0];
      const a3y =
        ((t3 - t) / (t3 - t2)) * p2[1] + ((t - t2) / (t3 - t2)) * p3[1];

      const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
      const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
      const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;

      const cx = ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x;
      const cy = ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y;

      result.push([cx, cy]);
    }
  }

  return result;
}

function synthesizeHistoricalPolls(f: FlightState): Position[] {
  if (f.longitude == null || f.latitude == null) return [];
  const lng = f.longitude;
  const lat = f.latitude;
  const heading = ((f.trueTrack ?? 0) * Math.PI) / 180;
  const speed = f.velocity ?? 200;
  const degPerSecond = speed / 111_320;

  const polls: Position[] = [];
  for (let i = HISTORICAL_BOOTSTRAP_POLLS; i >= 1; i--) {
    const tSec = HISTORICAL_BOOTSTRAP_STEP_SEC * i;
    const decay = 1 - (HISTORICAL_BOOTSTRAP_POLLS - i) * 0.08;
    const distanceDeg = Math.min(degPerSecond * tSec * decay, 0.06);
    polls.push([
      lng - Math.sin(heading) * distanceDeg,
      lat - Math.cos(heading) * distanceDeg,
    ]);
  }
  return polls;
}

class TrailStore {
  private trails = new Map<string, Position[]>();
  private seen = new Set<string>();
  private bootstrapUpdatesRemaining = BOOTSTRAP_UPDATES;

  update(flights: FlightState[]): TrailEntry[] {
    const current = new Set<string>();
    let processedFlightCount = 0;

    for (const f of flights) {
      if (f.longitude == null || f.latitude == null) continue;
      processedFlightCount += 1;
      const id = f.icao24;
      current.add(id);

      const pos: Position = [f.longitude, f.latitude];
      let trail = this.trails.get(id);

      if (!trail) {
        trail =
          this.bootstrapUpdatesRemaining > 0 ? synthesizeHistoricalPolls(f) : [];
        this.trails.set(id, trail);
      }

      if (trail.length === 0) {
        trail.push(pos);
        continue;
      }

      const last = trail[trail.length - 1];
      const dx = pos[0] - last[0];
      const dy = pos[1] - last[1];
      if (dx * dx + dy * dy > JUMP_THRESHOLD_DEG * JUMP_THRESHOLD_DEG) {
        trail.length = 0;
      }

      trail.push(pos);
      if (trail.length > MAX_POINTS) {
        trail.splice(0, trail.length - MAX_POINTS);
      }
    }

    for (const id of this.seen) {
      if (!current.has(id)) this.trails.delete(id);
    }
    this.seen = current;

    if (this.bootstrapUpdatesRemaining > 0 && processedFlightCount > 0) {
      this.bootstrapUpdatesRemaining -= 1;
    }

    const result: TrailEntry[] = [];
    for (const f of flights) {
      const trail = this.trails.get(f.icao24);
      if (trail && trail.length >= 2) {
        result.push({
          icao24: f.icao24,
          path: trail.length >= 5 ? catmullRomSmooth(trail) : [...trail],
          baroAltitude: f.baroAltitude,
        });
      }
    }
    return result;
  }
}

export function useTrailHistory(flights: FlightState[]): TrailEntry[] {
  const [store] = useState(() => new TrailStore());
  return useMemo(() => store.update(flights), [flights, store]);
}

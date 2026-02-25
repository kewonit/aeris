"use client";

import { useState, useMemo } from "react";
import type { FlightState } from "@/lib/opensky";

type Position = [lng: number, lat: number];

type TrailPoint = {
  position: Position;
  baroAltitude: number | null;
};

export type TrailEntry = {
  icao24: string;
  path: Position[];
  altitudes: Array<number | null>;
  baroAltitude: number | null;
  fullHistory?: boolean;
};

const MAX_POINTS = 100;
const JUMP_THRESHOLD_DEG = 0.3;
const HISTORICAL_BOOTSTRAP_POLLS = 3;
const HISTORICAL_BOOTSTRAP_STEP_SEC = 12;
const BOOTSTRAP_UPDATES = 3;
const ALTITUDE_RECENT_WINDOW = 6;
const ALTITUDE_SOFT_STEP_METERS = 500;
const ALTITUDE_HARD_STEP_METERS = 12_000;
const ALTITUDE_OUTLIER_BASE_METERS = 1_200;
const ALTITUDE_OUTLIER_SCALE = 3;
const ALTITUDE_SMOOTHING_ALPHA_TRUSTED = 0.9;
const ALTITUDE_SMOOTHING_ALPHA_GUARDED = 0.5;

type AltitudeState = {
  filtered: number | null;
  recent: number[];
  outlierStreak: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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
  private trails = new Map<string, TrailPoint[]>();
  private altitudeStates = new Map<string, AltitudeState>();
  private seen = new Set<string>();
  private bootstrapUpdatesRemaining = BOOTSTRAP_UPDATES;

  private filterAltitude(id: string, rawAltitude: number | null): number | null {
    if (rawAltitude == null) return null;

    const state =
      this.altitudeStates.get(id) ??
      ({ filtered: null, recent: [], outlierStreak: 0 } as AltitudeState);

    if (state.filtered == null) {
      state.filtered = rawAltitude;
      state.recent.push(rawAltitude);
      this.altitudeStates.set(id, state);
      return rawAltitude;
    }

    const med = median(state.recent);
    const absoluteDeviations = state.recent.map((x) => Math.abs(x - med));
    const mad = median(absoluteDeviations);
    const outlierThreshold =
      ALTITUDE_OUTLIER_BASE_METERS + ALTITUDE_OUTLIER_SCALE * Math.max(120, mad);

    const isOutlier = Math.abs(rawAltitude - med) > outlierThreshold;
    state.outlierStreak = isOutlier ? state.outlierStreak + 1 : 0;
    const trustedTarget = !isOutlier || state.outlierStreak >= 2;
    const maxStep = trustedTarget
      ? ALTITUDE_HARD_STEP_METERS
      : ALTITUDE_SOFT_STEP_METERS;
    const alpha = trustedTarget
      ? ALTITUDE_SMOOTHING_ALPHA_TRUSTED
      : ALTITUDE_SMOOTHING_ALPHA_GUARDED;

    const delta = rawAltitude - state.filtered;
    const clampedDelta = Math.max(
      -maxStep,
      Math.min(maxStep, delta),
    );

    const filtered = state.filtered + clampedDelta * alpha;
    state.filtered = filtered;
    state.recent.push(filtered);
    if (state.recent.length > ALTITUDE_RECENT_WINDOW) {
      state.recent.splice(0, state.recent.length - ALTITUDE_RECENT_WINDOW);
    }

    this.altitudeStates.set(id, state);
    return filtered;
  }

  update(flights: FlightState[]): TrailEntry[] {
    const current = new Set<string>();
    let processedFlightCount = 0;

    for (const f of flights) {
      if (f.longitude == null || f.latitude == null) continue;
      processedFlightCount += 1;
      const id = f.icao24;
      current.add(id);
      const filteredAltitude = this.filterAltitude(id, f.baroAltitude);

      const pos: TrailPoint = {
        position: [f.longitude, f.latitude],
        baroAltitude: filteredAltitude,
      };
      let trail = this.trails.get(id);

      if (!trail) {
        trail =
          this.bootstrapUpdatesRemaining > 0
            ? synthesizeHistoricalPolls(f).map((position) => ({
              position,
              baroAltitude: filteredAltitude,
            }))
            : [];
        this.trails.set(id, trail);
      }

      if (trail.length === 0) {
        trail.push(pos);
        continue;
      }

      const last = trail[trail.length - 1].position;
      const dx = pos.position[0] - last[0];
      const dy = pos.position[1] - last[1];
      if (dx * dx + dy * dy > JUMP_THRESHOLD_DEG * JUMP_THRESHOLD_DEG) {
        trail.length = 0;
      }

      trail.push(pos);
      if (trail.length > MAX_POINTS) {
        trail.splice(0, trail.length - MAX_POINTS);
      }
    }

    for (const id of this.seen) {
      if (!current.has(id)) {
        this.trails.delete(id);
        this.altitudeStates.delete(id);
      }
    }
    this.seen = current;

    if (this.bootstrapUpdatesRemaining > 0 && processedFlightCount > 0) {
      this.bootstrapUpdatesRemaining -= 1;
    }

    const result: TrailEntry[] = [];
    for (const f of flights) {
      const trail = this.trails.get(f.icao24);
      if (trail && trail.length >= 2) {
        const path = trail.map((p) => p.position);
        const altitudes = trail.map((p) => p.baroAltitude);

        result.push({
          icao24: f.icao24,
          path: [...path],
          altitudes,
          baroAltitude: altitudes[altitudes.length - 1] ?? null,
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

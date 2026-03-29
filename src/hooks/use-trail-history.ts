"use client";

import { useState, useMemo } from "react";
import type { FlightState } from "@/lib/opensky";

type Position = [lng: number, lat: number];

type TrailPoint = {
  position: Position;
  baroAltitude: number | null;
  timestamp: number;
};

export type TrailEntry = {
  icao24: string;
  path: Position[];
  altitudes: Array<number | null>;
  timestamps: number[];
  baroAltitude: number | null;
  fullHistory?: boolean;
};

const MAX_POINTS = 55;
const JUMP_THRESHOLD_DEG = 0.15;
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

/**
 * If the interval between consecutive update() calls exceeds this value,
 * the tab was likely hidden. Jump detection switches to a dynamic threshold
 * based on elapsed time and per-aircraft speed to avoid destroying trails
 * for legitimate movement during the absence.
 */
const RESUME_GAP_MS = 20_000;

/**
 * Conservative ceiling speed (m/s) for dynamic jump threshold when the
 * flight's actual velocity is unknown. ~350 m/s ≈ Mach 1 — covers all
 * commercial traffic with generous headroom.
 */
const MAX_REASONABLE_SPEED_MPS = 350;

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
  if (f.trueTrack == null || !Number.isFinite(f.trueTrack)) return [];
  if (f.velocity == null || !Number.isFinite(f.velocity) || f.velocity <= 0)
    return [];
  const lng = f.longitude;
  const lat = f.latitude;
  const heading = (f.trueTrack * Math.PI) / 180;
  const speed = f.velocity;
  const degPerSecond = speed / 111_320;

  // Perpendicular direction for GPS-like lateral jitter.
  // Without jitter, synthetic trails are ruler-straight which looks
  // artificial until real GPS data arrives.
  const perpHeading = heading + Math.PI / 2;
  const GPS_JITTER_DEG = 0.00018; // ~20 m at mid-latitudes

  const polls: Position[] = [];
  for (let i = HISTORICAL_BOOTSTRAP_POLLS; i >= 1; i--) {
    const tSec = HISTORICAL_BOOTSTRAP_STEP_SEC * i;
    const decay = 1 - (HISTORICAL_BOOTSTRAP_POLLS - i) * 0.08;
    const distanceDeg = Math.min(degPerSecond * tSec * decay, 0.06);

    // Alternating perpendicular offset — creates a subtle S-curve that
    // mimics real GPS measurement noise.
    const jitterSign = i % 2 === 0 ? 1 : -1;
    const jitter =
      GPS_JITTER_DEG *
      jitterSign *
      (0.4 + (i / HISTORICAL_BOOTSTRAP_POLLS) * 0.6);

    polls.push([
      lng - Math.sin(heading) * distanceDeg + Math.sin(perpHeading) * jitter,
      lat - Math.cos(heading) * distanceDeg + Math.cos(perpHeading) * jitter,
    ]);
  }
  return polls;
}

class TrailStore {
  private trails = new Map<string, TrailPoint[]>();
  private altitudeStates = new Map<string, AltitudeState>();
  private seen = new Set<string>();
  private bootstrapUpdatesRemaining = BOOTSTRAP_UPDATES;
  private lastUpdateTime = 0;
  /** Cached result from the last non-empty update — returned when empty
   *  flights would otherwise wipe all trail data. */
  private lastResult: TrailEntry[] = [];

  private filterAltitude(
    id: string,
    rawAltitude: number | null,
  ): number | null {
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
      ALTITUDE_OUTLIER_BASE_METERS +
      ALTITUDE_OUTLIER_SCALE * Math.max(120, mad);

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
    const clampedDelta = Math.max(-maxStep, Math.min(maxStep, delta));

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
    const now = Date.now();

    // ── Guard: empty flights with existing trail data ─────────────
    // If the flights array is empty but we already have trail data, a
    // transient API failure likely produced the empty set. Preserve
    // last-known trails instead of purging everything.
    if (flights.length === 0 && this.trails.size > 0) {
      return this.lastResult;
    }

    // ── Tab-resume awareness ──────────────────────────────────────
    // When the gap between updates exceeds 2× the normal poll interval,
    // the tab was probably hidden. Compute a dynamic per-flight jump
    // threshold so legitimate movement during absence is preserved.
    const elapsed = this.lastUpdateTime > 0 ? now - this.lastUpdateTime : 0;
    const isResuming = elapsed > RESUME_GAP_MS;
    const elapsedSec = elapsed / 1000;
    this.lastUpdateTime = now;

    const current = new Set<string>();
    let processedFlightCount = 0;

    for (const f of flights) {
      if (
        f.longitude == null ||
        f.latitude == null ||
        !Number.isFinite(f.longitude) ||
        !Number.isFinite(f.latitude)
      )
        continue;
      processedFlightCount += 1;
      const id = f.icao24;
      current.add(id);

      let trail = this.trails.get(id);
      const isNewEntry = !trail;

      // When an aircraft appears for the first time (or returns after
      // being absent), clear any stale altitude state. Without this,
      // a recycled icao24 would inherit the previous aircraft's
      // median/outlier history, clamping the new aircraft's real
      // altitude as an outlier for several polls.
      if (isNewEntry) {
        this.altitudeStates.delete(id);
      }

      const filteredAltitude = this.filterAltitude(id, f.baroAltitude);

      const pos: TrailPoint = {
        position: [f.longitude, f.latitude],
        baroAltitude: filteredAltitude,
        timestamp: now,
      };

      if (isNewEntry) {
        trail =
          this.bootstrapUpdatesRemaining > 0
            ? synthesizeHistoricalPolls(f).map((position, i) => ({
                position,
                baroAltitude: filteredAltitude,
                timestamp:
                  now -
                  (HISTORICAL_BOOTSTRAP_POLLS - i) *
                    HISTORICAL_BOOTSTRAP_STEP_SEC *
                    1000,
              }))
            : [];
        this.trails.set(id, trail);
      }

      // After the branch above, trail is guaranteed to be defined.
      const t = trail!;

      if (t.length === 0) {
        t.push(pos);
        continue;
      }

      // ── Jump detection with tab-resume dynamic threshold ──────
      const last = t[t.length - 1].position;
      const dx = pos.position[0] - last[0];
      const dy = pos.position[1] - last[1];
      const distSq = dx * dx + dy * dy;

      // ── Single-point outlier filter ───────────────────────────
      // If this point is far from the previous point but the previous
      // step was small, it's likely a GPS glitch — skip silently.
      const OUTLIER_THRESHOLD_DEG = 0.035; // ~3.9 km
      if (
        t.length >= 2 &&
        distSq > OUTLIER_THRESHOLD_DEG * OUTLIER_THRESHOLD_DEG
      ) {
        const secondLast = t[t.length - 2].position;
        const dx2 = last[0] - secondLast[0];
        const dy2 = last[1] - secondLast[1];
        const prevDistSq = dx2 * dx2 + dy2 * dy2;
        if (prevDistSq < OUTLIER_THRESHOLD_DEG * OUTLIER_THRESHOLD_DEG) {
          continue;
        }
      }

      // ── Heading-consistency filter ────────────────────────────
      // Reject points where implied GPS heading diverges too far
      // from ADS-B trueTrack (likely GPS/MLAT artifact).
      if (
        t.length >= 1 &&
        f.trueTrack != null &&
        Number.isFinite(f.trueTrack) &&
        distSq > 1e-10 // skip heading check for near-zero movement
      ) {
        const impliedHeading =
          ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
        let headingDelta = Math.abs(impliedHeading - f.trueTrack);
        if (headingDelta > 180) headingDelta = 360 - headingDelta;

        // Speed-scaled threshold: slow aircraft can turn faster.
        const speed =
          f.velocity != null && Number.isFinite(f.velocity) && f.velocity > 0
            ? f.velocity
            : 100;
        const headingThreshold = speed < 50 ? 110 : speed < 100 ? 90 : 70;
        if (headingDelta > headingThreshold) {
          continue;
        }
      }

      // ── V-shape (backtrack) filter ────────────────────────────
      // Reject points creating sharp V-turns (GPS bounce artifacts).
      if (t.length >= 2) {
        const prev = t[t.length - 2].position;
        const sdx1 = last[0] - prev[0];
        const sdy1 = last[1] - prev[1];
        const slen1 = Math.sqrt(sdx1 * sdx1 + sdy1 * sdy1);
        const slen2 = Math.sqrt(dx * dx + dy * dy);

        if (slen1 > 1e-8 && slen2 > 1e-8) {
          const cos = (sdx1 * dx + sdy1 * dy) / (slen1 * slen2);
          // cos < -0.3 ≈ turn > ~107°. Also reject moderate turns
          // with asymmetric segment lengths (GPS spike pattern).
          if (cos < -0.3) {
            continue;
          }
          if (cos < 0.1) {
            const ratio = Math.max(slen1, slen2) / Math.min(slen1, slen2);
            if (ratio > 3.5) {
              continue;
            }
          }
        }
      }

      let effectiveThreshold = JUMP_THRESHOLD_DEG;
      if (isResuming) {
        // Use per-aircraft speed if available, else conservative ceiling.
        const speed =
          f.velocity != null && Number.isFinite(f.velocity) && f.velocity > 0
            ? f.velocity
            : MAX_REASONABLE_SPEED_MPS;
        const maxLegitMoveDeg = (speed * elapsedSec * 1.5) / 111_320;
        effectiveThreshold = Math.max(JUMP_THRESHOLD_DEG, maxLegitMoveDeg);
      }

      if (distSq > effectiveThreshold * effectiveThreshold) {
        t.length = 0;
        this.altitudeStates.delete(id);
      }

      t.push(pos);
      if (t.length > MAX_POINTS) {
        t.splice(0, t.length - MAX_POINTS);
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
        const timestamps = trail.map((p) => p.timestamp);

        result.push({
          icao24: f.icao24,
          path: [...path],
          altitudes,
          timestamps,
          baroAltitude: altitudes[altitudes.length - 1] ?? null,
        });
      }
    }

    this.lastResult = result;
    return result;
  }
}

export function useTrailHistory(flights: FlightState[]): TrailEntry[] {
  const [store] = useState(() => new TrailStore());
  return useMemo(() => store.update(flights), [flights, store]);
}

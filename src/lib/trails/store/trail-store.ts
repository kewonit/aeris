import { useSyncExternalStore } from "react";

import type { FlightState, FlightTrack } from "@/lib/opensky";

import { SELECTED_TRAIL_GRACE_MS } from "../constants";
import { buildTrailGeometry } from "../geometry/build-trail-geometry";
import { getNextNegativeBackoffMs } from "../source/provider-health";
import type {
  TrailEntry,
  TrailEnvelope,
  TrailHistoryState,
  TrailOutcome,
  TrailProviderId,
  TrailSampleQuality,
  TrailSegment,
  TrailSnapshot,
} from "../types";

type Listener = () => void;
type Position = [lng: number, lat: number];

type TrailPoint = {
  position: Position;
  baroAltitude: number | null;
  timestamp: number;
  track: number | null;
  groundSpeed: number | null;
  quality: TrailSampleQuality;
  onGround: boolean;
};

type AltitudeState = {
  filtered: number | null;
  recent: number[];
  outlierStreak: number;
};

type InternalHistoryState = TrailHistoryState & {
  negativeBackoffMs: number;
};

export type TrailStoreSnapshot = {
  trails: TrailEntry[];
  history: TrailHistoryState;
  selectedTrack: FlightTrack | null;
  selectedEnvelope: TrailEnvelope | null;
};

const MAX_LIVE_POINTS = 360;
const MAX_SELECTED_LIVE_POINTS = 720;
const MAX_LIVE_AGE_MS = 6 * 60_000;
const MAX_SELECTED_LIVE_AGE_MS = 12 * 60_000;
const SPARSE_INTERVAL_MS = 25_000;
const JUMP_THRESHOLD_DEG = 0.15;
const HISTORICAL_BOOTSTRAP_POLLS = 3;
const HISTORICAL_BOOTSTRAP_STEP_SEC = 12;
const BOOTSTRAP_UPDATES = 3;
const LOW_PHASE_ALTITUDE_M = 2_000;
const ALTITUDE_RECENT_WINDOW = 6;
const ALTITUDE_SOFT_STEP_METERS = 500;
const ALTITUDE_HARD_STEP_METERS = 12_000;
const ALTITUDE_OUTLIER_BASE_METERS = 1_200;
const ALTITUDE_OUTLIER_SCALE = 3;
const ALTITUDE_SMOOTHING_ALPHA_TRUSTED = 0.9;
const ALTITUDE_SMOOTHING_ALPHA_GUARDED = 0.5;
const MAX_REASONABLE_SPEED_MPS = 350;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function getFlightSpeedMps(flight: FlightState): number {
  return flight.velocity != null &&
    Number.isFinite(flight.velocity) &&
    flight.velocity > 0
    ? flight.velocity
    : MAX_REASONABLE_SPEED_MPS;
}

function getPointIntervalMs(now: number, liveTrail: TrailPoint[]): number {
  const lastTimestamp = liveTrail[liveTrail.length - 1]?.timestamp ?? now;
  return Math.max(1_000, now - lastTimestamp);
}

function getDynamicMoveThresholdDeg(params: {
  speedMps: number;
  intervalMs: number;
  baseThresholdDeg: number;
  safetyMultiplier: number;
}): number {
  const intervalSec = Math.max(1, params.intervalMs / 1000);
  const expectedMoveDeg =
    (params.speedMps * intervalSec * params.safetyMultiplier) / 111_320;

  return Math.max(params.baseThresholdDeg, expectedMoveDeg);
}

function normalizeHeadingDeltaDeg(left: number, right: number): number {
  let delta = Math.abs(left - right);
  if (delta > 180) {
    delta = 360 - delta;
  }
  return delta;
}

function getImpliedHeadingDeg(from: Position, to: Position): number {
  return (
    ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360
  );
}

function getRecentTurnDeltaDeg(
  liveTrail: TrailPoint[],
  nextPoint: TrailPoint,
): number {
  if (liveTrail.length < 2) {
    return 0;
  }

  const previous = liveTrail[liveTrail.length - 2].position;
  const current = liveTrail[liveTrail.length - 1].position;
  const before = getImpliedHeadingDeg(previous, current);
  const after = getImpliedHeadingDeg(current, nextPoint.position);
  return normalizeHeadingDeltaDeg(before, after);
}

function isLowPhaseTrailPoint(point: TrailPoint): boolean {
  return (
    point.onGround ||
    (point.baroAltitude != null && point.baroAltitude <= LOW_PHASE_ALTITUDE_M)
  );
}

function trimLiveTrailWindow(
  liveTrail: TrailPoint[],
  now: number,
  selected: boolean,
): void {
  const maxPoints = selected ? MAX_SELECTED_LIVE_POINTS : MAX_LIVE_POINTS;
  const maxAgeMs = selected ? MAX_SELECTED_LIVE_AGE_MS : MAX_LIVE_AGE_MS;

  while (liveTrail.length > maxPoints) {
    liveTrail.shift();
  }

  while (liveTrail.length > 2 && now - liveTrail[0].timestamp > maxAgeMs) {
    liveTrail.shift();
  }
}

function synthesizeHistoricalPolls(flight: FlightState): Position[] {
  if (flight.longitude == null || flight.latitude == null) return [];
  if (flight.trueTrack == null || !Number.isFinite(flight.trueTrack)) return [];
  if (
    flight.velocity == null ||
    !Number.isFinite(flight.velocity) ||
    flight.velocity <= 0
  ) {
    return [];
  }

  const heading = (flight.trueTrack * Math.PI) / 180;
  const speed = flight.velocity;
  const degPerSecond = speed / 111_320;
  const perpHeading = heading + Math.PI / 2;
  const gpsJitterDeg = 0.00018;

  const polls: Position[] = [];
  for (let index = HISTORICAL_BOOTSTRAP_POLLS; index >= 1; index -= 1) {
    const tSec = HISTORICAL_BOOTSTRAP_STEP_SEC * index;
    const decay = 1 - (HISTORICAL_BOOTSTRAP_POLLS - index) * 0.08;
    const distanceDeg = Math.min(degPerSecond * tSec * decay, 0.06);
    const jitterSign = index % 2 === 0 ? 1 : -1;
    const jitter =
      gpsJitterDeg *
      jitterSign *
      (0.4 + (index / HISTORICAL_BOOTSTRAP_POLLS) * 0.6);
    polls.push([
      flight.longitude -
        Math.sin(heading) * distanceDeg +
        Math.sin(perpHeading) * jitter,
      flight.latitude -
        Math.cos(heading) * distanceDeg +
        Math.cos(perpHeading) * jitter,
    ]);
  }

  return polls;
}

function trailPointToSnapshot(point: TrailPoint): TrailSnapshot {
  return {
    source: "live",
    timestamp: point.timestamp,
    lng: point.position[0],
    lat: point.position[1],
    altitude: point.baroAltitude,
    track: point.track,
    groundSpeed: point.groundSpeed,
    quality: point.quality,
    onGround: point.onGround,
  };
}

function trackToTrailSegment(
  provider: TrailProviderId,
  track: FlightTrack,
): TrailSegment {
  return {
    kind: "historical",
    provider,
    samples: track.path
      .filter(
        (waypoint) =>
          waypoint.longitude != null &&
          waypoint.latitude != null &&
          Number.isFinite(waypoint.longitude) &&
          Number.isFinite(waypoint.latitude),
      )
      .map((waypoint) => ({
        source: provider,
        timestamp: waypoint.time,
        lng: waypoint.longitude!,
        lat: waypoint.latitude!,
        altitude:
          waypoint.baroAltitude != null &&
          Number.isFinite(waypoint.baroAltitude)
            ? waypoint.baroAltitude
            : null,
        track:
          waypoint.trueTrack != null && Number.isFinite(waypoint.trueTrack)
            ? waypoint.trueTrack
            : null,
        groundSpeed: null,
        quality: "authoritative-trace",
        onGround: waypoint.onGround,
      })),
  };
}

function createHistoryState(): InternalHistoryState {
  return {
    selectedIcao24: null,
    selectionGeneration: 0,
    loading: false,
    provider: null,
    outcome: null,
    cooldownUntil: 0,
    creditsRemaining: null,
    missingSinceMs: null,
    negativeBackoffMs: 0,
  };
}

function toPublicHistoryState(
  history: InternalHistoryState,
): TrailHistoryState {
  return {
    selectedIcao24: history.selectedIcao24,
    selectionGeneration: history.selectionGeneration,
    loading: history.loading,
    provider: history.provider,
    outcome: history.outcome,
    cooldownUntil: history.cooldownUntil,
    creditsRemaining: history.creditsRemaining,
    missingSinceMs: history.missingSinceMs,
  };
}

function createEnvelope(icao24: string): TrailEnvelope {
  return {
    icao24,
    provider: null,
    outcome: "live-tail-only",
    selectionGeneration: 0,
    liveRevision: 0,
    historyRevision: 0,
    lastSeenAt: 0,
    liveTail: [],
    historySegments: [],
    entry: null,
  };
}

export function createTrailStore() {
  const listeners = new Set<Listener>();
  const trails = new Map<string, TrailPoint[]>();
  const altitudeStates = new Map<string, AltitudeState>();
  const envelopes = new Map<string, TrailEnvelope>();
  let seen = new Set<string>();
  let bootstrapUpdatesRemaining = BOOTSTRAP_UPDATES;
  let resumePending = false;
  let liveOrder: string[] = [];
  const history = createHistoryState();
  let selectedTrack: FlightTrack | null = null;
  let snapshot: TrailStoreSnapshot = {
    trails: [],
    history: toPublicHistoryState(history),
    selectedTrack,
    selectedEnvelope: null,
  };

  function emit(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) {
      listener();
    }
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): TrailStoreSnapshot {
    return snapshot;
  }

  function filterAltitude(
    id: string,
    rawAltitude: number | null,
  ): number | null {
    if (rawAltitude == null) return null;

    const state =
      altitudeStates.get(id) ??
      ({ filtered: null, recent: [], outlierStreak: 0 } as AltitudeState);

    if (state.filtered == null) {
      state.filtered = rawAltitude;
      state.recent.push(rawAltitude);
      altitudeStates.set(id, state);
      return rawAltitude;
    }

    const med = median(state.recent);
    const absoluteDeviations = state.recent.map((value) =>
      Math.abs(value - med),
    );
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

    altitudeStates.set(id, state);
    return filtered;
  }

  function getOrCreateEnvelope(icao24: string): TrailEnvelope {
    const existing = envelopes.get(icao24);
    if (existing) {
      return existing;
    }

    const created = createEnvelope(icao24);
    envelopes.set(icao24, created);
    return created;
  }

  function updateEnvelopeEntry(icao24: string): void {
    const envelope = envelopes.get(icao24);
    if (!envelope) {
      return;
    }

    envelope.entry = buildTrailGeometry(envelope);
  }

  function buildSnapshot(): TrailStoreSnapshot {
    const nextTrails: TrailEntry[] = [];

    for (const icao24 of liveOrder) {
      const entry = envelopes.get(icao24)?.entry;
      if (entry && entry.path.length >= 2) {
        nextTrails.push(entry);
      }
    }

    if (history.selectedIcao24 && !liveOrder.includes(history.selectedIcao24)) {
      const selectedEntry = envelopes.get(history.selectedIcao24)?.entry;
      if (selectedEntry && selectedEntry.path.length >= 2) {
        nextTrails.push(selectedEntry);
      }
    }

    return {
      trails: nextTrails,
      history: toPublicHistoryState(history),
      selectedTrack,
      selectedEnvelope: history.selectedIcao24
        ? (envelopes.get(history.selectedIcao24) ?? null)
        : null,
    };
  }

  function ingestLiveFlights(flights: FlightState[]): void {
    const now = Date.now();

    if (flights.length === 0 && trails.size > 0) {
      return;
    }

    // On the first ingestion after a visibility resume, clear live trail
    // arrays so we don't create straight-line artifacts from the last
    // pre-background position to the current position. The envelope data
    // (liveTail, historySegments) is NOT cleared here — it preserves the
    // visual trail until the loop below updates each envelope with fresh data.
    if (resumePending && flights.length > 0) {
      trails.clear();
      altitudeStates.clear();
      resumePending = false;
    }

    const current = new Set<string>();
    let processedFlightCount = 0;
    liveOrder = [];

    for (const flight of flights) {
      if (
        flight.longitude == null ||
        flight.latitude == null ||
        !Number.isFinite(flight.longitude) ||
        !Number.isFinite(flight.latitude)
      ) {
        continue;
      }

      processedFlightCount += 1;
      const id = flight.icao24.trim().toLowerCase();
      current.add(id);
      liveOrder.push(id);
      const speedMps = getFlightSpeedMps(flight);

      let trail = trails.get(id);
      const isNewEntry = !trail;

      if (isNewEntry) {
        altitudeStates.delete(id);
      }

      const filteredAltitude = filterAltitude(id, flight.baroAltitude);
      const point: TrailPoint = {
        position: [flight.longitude, flight.latitude],
        baroAltitude: filteredAltitude,
        timestamp: now,
        track:
          flight.trueTrack != null && Number.isFinite(flight.trueTrack)
            ? flight.trueTrack
            : null,
        groundSpeed:
          flight.velocity != null && Number.isFinite(flight.velocity)
            ? flight.velocity
            : null,
        quality: "authoritative-live",
        onGround: flight.onGround,
      };

      if (isNewEntry) {
        trail =
          bootstrapUpdatesRemaining > 0
            ? synthesizeHistoricalPolls(flight).map((position, index) => ({
                position,
                baroAltitude: filteredAltitude,
                timestamp:
                  now -
                  (HISTORICAL_BOOTSTRAP_POLLS - index) *
                    HISTORICAL_BOOTSTRAP_STEP_SEC *
                    1000,
                track: point.track,
                groundSpeed: point.groundSpeed,
                quality: "suspect",
                onGround: point.onGround,
              }))
            : [];
        trails.set(id, trail);
      }

      const liveTrail = trail!;
      if (liveTrail.length === 0) {
        liveTrail.push(point);
      } else {
        const last = liveTrail[liveTrail.length - 1].position;
        const dx = point.position[0] - last[0];
        const dy = point.position[1] - last[1];
        const distSq = dx * dx + dy * dy;

        const pointIntervalMs = getPointIntervalMs(now, liveTrail);
        const sparseInterval = pointIntervalMs >= SPARSE_INTERVAL_MS;
        const recentTurnDeltaDeg = getRecentTurnDeltaDeg(liveTrail, point);
        const jumpThresholdDeg = getDynamicMoveThresholdDeg({
          speedMps,
          intervalMs: pointIntervalMs,
          baseThresholdDeg: JUMP_THRESHOLD_DEG,
          safetyMultiplier: 2.0,
        });

        if (distSq > jumpThresholdDeg * jumpThresholdDeg) {
          liveTrail.length = 0;
          altitudeStates.delete(id);
        } else {
          const outlierThresholdDeg = getDynamicMoveThresholdDeg({
            speedMps,
            intervalMs: pointIntervalMs,
            baseThresholdDeg: 0.035,
            safetyMultiplier: 1.6,
          });

          if (
            liveTrail.length >= 2 &&
            distSq > outlierThresholdDeg * outlierThresholdDeg
          ) {
            const secondLast = liveTrail[liveTrail.length - 2].position;
            const dx2 = last[0] - secondLast[0];
            const dy2 = last[1] - secondLast[1];
            const prevDistSq = dx2 * dx2 + dy2 * dy2;

            if (prevDistSq < outlierThresholdDeg * outlierThresholdDeg) {
              continue;
            }
          }

          if (
            liveTrail.length >= 1 &&
            flight.trueTrack != null &&
            Number.isFinite(flight.trueTrack) &&
            distSq > 1e-10
          ) {
            const impliedHeading = getImpliedHeadingDeg(last, point.position);
            const headingDelta = normalizeHeadingDeltaDeg(
              impliedHeading,
              flight.trueTrack,
            );

            const speed =
              flight.velocity != null &&
              Number.isFinite(flight.velocity) &&
              flight.velocity > 0
                ? flight.velocity
                : 100;
            const lastPoint = liveTrail[liveTrail.length - 1];
            const baseHeadingThreshold =
              speed < 50 ? 110 : speed < 100 ? 90 : 70;
            let headingThreshold =
              sparseInterval || recentTurnDeltaDeg > 55
                ? Math.max(baseHeadingThreshold, 140)
                : baseHeadingThreshold;

            if (
              speed <= 120 &&
              (isLowPhaseTrailPoint(lastPoint) || isLowPhaseTrailPoint(point))
            ) {
              headingThreshold = Math.max(headingThreshold, 150);
            }

            if (headingDelta > headingThreshold) {
              continue;
            }
          }

          if (liveTrail.length >= 2) {
            const prev = liveTrail[liveTrail.length - 2].position;
            const sdx1 = last[0] - prev[0];
            const sdy1 = last[1] - prev[1];
            const slen1 = Math.sqrt(sdx1 * sdx1 + sdy1 * sdy1);
            const slen2 = Math.sqrt(dx * dx + dy * dy);

            if (slen1 > 1e-8 && slen2 > 1e-8) {
              const cosine = (sdx1 * dx + sdy1 * dy) / (slen1 * slen2);
              const allowSharpTurn = sparseInterval || recentTurnDeltaDeg > 70;

              if (cosine < (allowSharpTurn ? -0.9 : -0.3)) {
                continue;
              }
              if (cosine < 0.1) {
                const ratio = Math.max(slen1, slen2) / Math.min(slen1, slen2);
                if (ratio > (allowSharpTurn ? 8 : 3.5)) {
                  continue;
                }
              }
            }
          }
        }

        liveTrail.push(point);
        trimLiveTrailWindow(liveTrail, now, id === history.selectedIcao24);
      }

      const envelope = getOrCreateEnvelope(id);
      envelope.liveTail = liveTrail.map(trailPointToSnapshot);
      envelope.liveRevision += 1;
      envelope.lastSeenAt = now;
      if (id === history.selectedIcao24) {
        envelope.selectionGeneration = history.selectionGeneration;
        history.missingSinceMs = null;
      }
      if (envelope.historySegments.length === 0) {
        envelope.provider = null;
        envelope.outcome = "live-tail-only";
      }
      updateEnvelopeEntry(id);
    }

    for (const id of seen) {
      if (!current.has(id) && id !== history.selectedIcao24) {
        trails.delete(id);
        altitudeStates.delete(id);
        envelopes.delete(id);
      }
    }

    if (history.selectedIcao24 && !current.has(history.selectedIcao24)) {
      markSelectedMissing(now);
    } else if (history.selectedIcao24) {
      history.missingSinceMs = null;
    }

    seen = current;

    if (bootstrapUpdatesRemaining > 0 && processedFlightCount > 0) {
      bootstrapUpdatesRemaining -= 1;
    }

    emit();
  }

  function selectAircraft(icao24: string | null): number {
    const normalized = icao24?.trim().toLowerCase() ?? null;
    if (history.selectedIcao24 === normalized) {
      return history.selectionGeneration;
    }

    const previousSelected = history.selectedIcao24;
    history.selectionGeneration += 1;
    history.selectedIcao24 = normalized;
    history.loading = !!normalized;
    history.provider = null;
    history.outcome = null;
    history.cooldownUntil = 0;
    history.creditsRemaining = null;
    history.missingSinceMs = null;
    history.negativeBackoffMs = 0;
    selectedTrack = null;

    if (previousSelected && previousSelected !== normalized) {
      const previousEnvelope = envelopes.get(previousSelected);
      if (previousEnvelope) {
        previousEnvelope.historySegments = [];
        previousEnvelope.historyRevision += 1;
        previousEnvelope.provider = null;
        previousEnvelope.outcome = "live-tail-only";
        previousEnvelope.selectionGeneration = 0;
        updateEnvelopeEntry(previousSelected);
      }
    }

    if (normalized) {
      const envelope = getOrCreateEnvelope(normalized);
      envelope.selectionGeneration = history.selectionGeneration;
      updateEnvelopeEntry(normalized);
    }

    emit();
    return history.selectionGeneration;
  }

  function startHistoryLoad(params?: { selectionGeneration?: number }): void {
    if (
      params?.selectionGeneration != null &&
      params.selectionGeneration !== history.selectionGeneration
    ) {
      return;
    }

    if (!history.selectedIcao24) {
      return;
    }

    history.loading = true;
    emit();
  }

  function resolveHistory(params: {
    icao24: string;
    selectionGeneration: number;
    provider: TrailProviderId | null;
    outcome: TrailOutcome;
    creditsRemaining?: number | null;
    path?: [number, number][];
    track?: FlightTrack | null;
  }): void {
    const normalized = params.icao24.trim().toLowerCase();
    if (
      params.selectionGeneration !== history.selectionGeneration ||
      history.selectedIcao24 !== normalized
    ) {
      return;
    }

    const envelope = getOrCreateEnvelope(normalized);
    envelope.selectionGeneration = params.selectionGeneration;
    envelope.provider = params.provider;
    envelope.outcome = params.outcome;
    if (params.track) {
      envelope.historySegments = [
        trackToTrailSegment(params.provider ?? "opensky", params.track),
      ];
      selectedTrack = params.track;
    } else if (params.outcome === "live-tail-only") {
      envelope.historySegments = [];
      selectedTrack = null;
    }
    envelope.historyRevision += 1;

    history.loading = false;
    history.provider = params.provider;
    history.outcome = params.outcome;
    history.creditsRemaining = params.creditsRemaining ?? null;
    history.cooldownUntil = 0;
    history.missingSinceMs = null;
    history.negativeBackoffMs = 0;

    updateEnvelopeEntry(normalized);
    emit();
  }

  function failHistory(params: {
    icao24: string;
    selectionGeneration: number;
    provider: TrailProviderId | null;
    outcome: TrailOutcome;
    cooldownUntil: number;
    creditsRemaining?: number | null;
  }): void {
    const normalized = params.icao24.trim().toLowerCase();
    if (
      params.selectionGeneration !== history.selectionGeneration ||
      history.selectedIcao24 !== normalized
    ) {
      return;
    }

    const envelope = getOrCreateEnvelope(normalized);
    envelope.selectionGeneration = params.selectionGeneration;
    envelope.provider = params.provider;
    envelope.outcome = params.outcome;
    updateEnvelopeEntry(normalized);

    history.loading = false;
    history.provider = params.provider;
    history.outcome = params.outcome;
    history.creditsRemaining = params.creditsRemaining ?? null;
    history.cooldownUntil = params.cooldownUntil;
    history.negativeBackoffMs = getNextNegativeBackoffMs(
      history.negativeBackoffMs,
    );

    emit();
  }

  function markSelectedMissing(now: number): void {
    if (!history.selectedIcao24) {
      return;
    }

    if (history.missingSinceMs == null) {
      history.missingSinceMs = now;
      emit();
      return;
    }

    if (now - history.missingSinceMs < SELECTED_TRAIL_GRACE_MS) {
      return;
    }

    const envelope = envelopes.get(history.selectedIcao24);
    if (envelope) {
      envelope.historySegments = [];
      envelope.historyRevision += 1;
      envelope.provider = null;
      envelope.outcome = "live-tail-only";
      updateEnvelopeEntry(history.selectedIcao24);
    }

    history.outcome = "live-tail-only";
    emit();
  }

  /** Signal that the tab just became visible again.
   *  Set a flag so the next ingestLiveFlights call resets live trail arrays
   *  at the same moment fresh data arrives — this avoids both straight-line
   *  artifacts (from stale→new position) and visible trail flicker (from
   *  clearing before new data is available). */
  function handleVisibilityResume(): void {
    resumePending = true;
    bootstrapUpdatesRemaining = BOOTSTRAP_UPDATES;
    emit();
  }

  return {
    subscribe,
    getSnapshot,
    ingestLiveFlights,
    selectAircraft,
    startHistoryLoad,
    resolveHistory,
    failHistory,
    markSelectedMissing,
    handleVisibilityResume,
  };
}

export const trailStore = createTrailStore();

export function useTrailStoreSnapshot<T>(
  selector: (snapshot: TrailStoreSnapshot) => T,
): T {
  return useSyncExternalStore(
    trailStore.subscribe,
    () => selector(trailStore.getSnapshot()),
    () => selector(trailStore.getSnapshot()),
  );
}

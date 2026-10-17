import { useSyncExternalStore } from "react";

import { MLAT_POSITION_ALPHA } from "@/lib/flight-utils";
import type { FlightState, FlightTrack } from "@/lib/opensky";

import {
  angleBetween,
  isContinuous,
  mergeHistoryAndLive,
  offsetMeters,
  sampleFromFlight,
  splitIntoParts,
  trackToSamples,
} from "../geometry/trail-parts";
import type {
  TrailHistoryState,
  TrailOutcome,
  TrailProviderId,
  TrailSample,
  TrailTrack,
} from "../types";

/** Live samples kept per aircraft; the longest trail setting. */
const LIVE_WINDOW_MS = 30 * 60_000;
/** An aircraft missing from the feed this long loses its trail. */
const STALE_AIRCRAFT_MS = 60_000;
/** Live samples further apart than this were not watched in between. */
const LIVE_GAP_MS = 90_000;
/** A line across a gap is drawn only if it runs within this of the track. */
const STRAIGHT_ACROSS_GAP_RAD = (30 * Math.PI) / 180;
/** A step this soon after the last can be judged against the track... */
const BACKWARD_CHECK_MS = 20_000;
/** ...for an aircraft this fast, which cannot hover or turn on the spot... */
const BACKWARD_CHECK_MIN_SPEED_MPS = 30;
/** ...and a step this far off its track is behind it. */
const BACKWARD_RAD = (120 * Math.PI) / 180;

type Listener = () => void;

type Entry = {
  live: TrailSample[];
  history: TrailSample[];
  /** Local time the feed last included this aircraft. */
  lastSeenAt: number;
  track: TrailTrack | null;
  dirty: boolean;
};

export type TrailStoreSnapshot = {
  trails: TrailTrack[];
  history: TrailHistoryState;
};

function trackDirection(flight: FlightState): [number, number] | null {
  const track = flight.trueTrack;
  if (track == null || !Number.isFinite(track)) return null;
  const radians = (track * Math.PI) / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

/**
 * Whether a position lies behind a fast airborne aircraft seconds after
 * the last one. No aircraft turns that far that quickly, so it is a stale
 * position, often relayed by another receiver.
 */
function isBackwardStep(
  last: TrailSample,
  sample: TrailSample,
  flight: FlightState,
): boolean {
  const direction = trackDirection(flight);
  const speed = flight.velocity ?? 0;
  if (
    !direction ||
    flight.onGround ||
    !(speed >= BACKWARD_CHECK_MIN_SPEED_MPS) ||
    sample.t - last.t > BACKWARD_CHECK_MS
  ) {
    return false;
  }
  return angleBetween(offsetMeters(last, sample), direction) > BACKWARD_RAD;
}

/**
 * Whether the aircraft turned while no live samples arrived, so a straight
 * line across the gap would leave its track or the trail before the gap.
 */
function turnedDuringGap(
  live: TrailSample[],
  sample: TrailSample,
  flight: FlightState,
): boolean {
  const last = live[live.length - 1];
  const before = live[live.length - 2];
  const chord = offsetMeters(last, sample);
  const directions = [
    trackDirection(flight),
    before ? offsetMeters(before, last) : null,
  ].filter((direction) => direction != null);
  return (
    directions.length === 0 ||
    directions.some(
      (direction) => angleBetween(chord, direction) > STRAIGHT_ACROSS_GAP_RAD,
    )
  );
}

function createHistoryState(): TrailHistoryState {
  return {
    selectedIcao24: null,
    selectionGeneration: 0,
    loading: false,
    provider: null,
    outcome: null,
    cooldownUntil: 0,
    creditsRemaining: null,
  };
}

export function createTrailStore() {
  const listeners = new Set<Listener>();
  const entries = new Map<string, Entry>();
  let revision = 0;
  let history = createHistoryState();
  let snapshot: TrailStoreSnapshot = { trails: [], history };

  function getEntry(icao24: string, now: number): Entry {
    let entry = entries.get(icao24);
    if (!entry) {
      entry = {
        live: [],
        history: [],
        lastSeenAt: now,
        track: null,
        dirty: true,
      };
      entries.set(icao24, entry);
    }
    return entry;
  }

  function trackFor(icao24: string, entry: Entry): TrailTrack {
    if (!entry.track || entry.dirty) {
      revision += 1;
      entry.track = {
        icao24,
        parts: splitIntoParts(mergeHistoryAndLive(entry.history, entry.live)),
        revision,
        hasHistory: entry.history.length > 0,
      };
      entry.dirty = false;
    }
    return entry.track;
  }

  function emit(): void {
    const trails: TrailTrack[] = [];
    for (const [icao24, entry] of entries) {
      if (entry.live.length > 0 || entry.history.length > 0) {
        trails.push(trackFor(icao24, entry));
      }
    }
    snapshot = { trails, history };
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

  function ingestLiveFlights(
    flights: FlightState[],
    { now = Date.now() }: { now?: number } = {},
  ): void {
    // An empty poll is a failed fetch far more often than an empty sky.
    if (flights.length === 0 && entries.size > 0) {
      return;
    }

    let changed = false;
    for (const flight of flights) {
      const sample = sampleFromFlight(flight);
      if (!sample) continue;

      const entry = getEntry(flight.icao24.trim().toLowerCase(), now);
      entry.lastSeenAt = now;

      const last = entry.live[entry.live.length - 1];
      if (
        last &&
        (sample.t <= last.t ||
          (sample.lng === last.lng && sample.lat === last.lat) ||
          isBackwardStep(last, sample, flight))
      ) {
        continue;
      }
      if (
        last &&
        sample.t - last.t > LIVE_GAP_MS &&
        turnedDuringGap(entry.live, sample, flight)
      ) {
        sample.afterGap = true;
      }

      // The map eases MLAT positions to hide their noise, so the trail
      // eases them the same way to stay attached to the aircraft.
      if (
        last &&
        flight.positionSource === "mlat" &&
        isContinuous(last, sample)
      ) {
        sample.lng = last.lng + (sample.lng - last.lng) * MLAT_POSITION_ALPHA;
        sample.lat = last.lat + (sample.lat - last.lat) * MLAT_POSITION_ALPHA;
      }

      entry.live.push(sample);
      const cutoff = sample.t - LIVE_WINDOW_MS;
      let expired = 0;
      while (
        expired < entry.live.length - 1 &&
        entry.live[expired].t < cutoff
      ) {
        expired += 1;
      }
      if (expired > 0) {
        entry.live.splice(0, expired);
      }
      entry.dirty = true;
      changed = true;
    }

    for (const [icao24, entry] of entries) {
      if (
        icao24 !== history.selectedIcao24 &&
        now - entry.lastSeenAt > STALE_AIRCRAFT_MS
      ) {
        entries.delete(icao24);
        changed = true;
      }
    }

    if (changed) {
      emit();
    }
  }

  function selectAircraft(icao24: string | null): number {
    const normalized = icao24?.trim().toLowerCase() || null;
    if (history.selectedIcao24 === normalized) {
      return history.selectionGeneration;
    }

    const previous = history.selectedIcao24
      ? entries.get(history.selectedIcao24)
      : undefined;
    if (previous && previous.history.length > 0) {
      previous.history = [];
      previous.dirty = true;
    }

    history = {
      ...createHistoryState(),
      selectedIcao24: normalized,
      selectionGeneration: history.selectionGeneration + 1,
      loading: normalized !== null,
    };
    emit();
    return history.selectionGeneration;
  }

  function isCurrentSelection(icao24: string, selectionGeneration: number) {
    return (
      selectionGeneration === history.selectionGeneration &&
      icao24.trim().toLowerCase() === history.selectedIcao24
    );
  }

  function startHistoryLoad(selectionGeneration: number): void {
    if (
      selectionGeneration !== history.selectionGeneration ||
      !history.selectedIcao24
    ) {
      return;
    }
    history = { ...history, loading: true };
    emit();
  }

  function resolveHistory(params: {
    icao24: string;
    selectionGeneration: number;
    provider: TrailProviderId | null;
    outcome: TrailOutcome;
    creditsRemaining?: number | null;
    track: FlightTrack | null;
  }): void {
    if (!isCurrentSelection(params.icao24, params.selectionGeneration)) {
      return;
    }

    const entry = getEntry(history.selectedIcao24!, Date.now());
    if (params.track) {
      entry.history = trackToSamples(params.track);
      entry.dirty = true;
    } else if (
      params.outcome === "live-tail-only" &&
      entry.history.length > 0
    ) {
      entry.history = [];
      entry.dirty = true;
    }

    history = {
      ...history,
      loading: false,
      provider: params.provider,
      outcome: params.outcome,
      creditsRemaining: params.creditsRemaining ?? null,
      cooldownUntil: 0,
    };
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
    if (!isCurrentSelection(params.icao24, params.selectionGeneration)) {
      return;
    }

    history = {
      ...history,
      loading: false,
      provider: params.provider,
      outcome: params.outcome,
      creditsRemaining: params.creditsRemaining ?? null,
      cooldownUntil: params.cooldownUntil,
    };
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

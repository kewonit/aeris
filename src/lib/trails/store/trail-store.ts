import { useSyncExternalStore } from "react";

import { MLAT_POSITION_ALPHA } from "@/lib/flight-utils";
import type { FlightState, FlightTrack } from "@/lib/opensky";

import {
  isContinuous,
  mergeHistoryAndLive,
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
    {
      now = Date.now(),
      authoritativeEmpty = false,
    }: {
      now?: number;
      /** The relay vouches that an empty list really is an empty sky. */
      authoritativeEmpty?: boolean;
    } = {},
  ): void {
    // An empty poll is a failed fetch far more often than an empty sky.
    if (flights.length === 0 && entries.size > 0 && !authoritativeEmpty) {
      return;
    }

    let changed = false;
    for (const flight of flights) {
      const sample = sampleFromFlight(flight);
      if (!sample) continue;

      const entry = getEntry(flight.icao24.trim().toLowerCase(), now);
      entry.lastSeenAt = now;

      // A new relay track is a new flight session, so the old one goes.
      const previous = entry.live[entry.live.length - 1];
      if (previous && sample.trackId !== previous.trackId) {
        entry.live = [];
        entry.history = [];
        entry.dirty = true;
        changed = true;
      }

      const last = entry.live[entry.live.length - 1];
      if (
        last &&
        (sample.t <= last.t ||
          (sample.lng === last.lng && sample.lat === last.lat))
      ) {
        continue;
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
    /** History that is already samples, as the relay sends it. */
    samples?: TrailSample[];
  }): void {
    if (!isCurrentSelection(params.icao24, params.selectionGeneration)) {
      return;
    }

    const entry = getEntry(history.selectedIcao24!, Date.now());
    if (params.samples) {
      entry.history = params.samples;
      entry.dirty = true;
    } else if (params.track) {
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

  /** Recent relay history for every aircraft in view. */
  function hydrateViewportHistory(
    tracks: Array<{ icao24: string; samples: TrailSample[] }>,
  ): void {
    let changed = false;
    const now = Date.now();
    for (const track of tracks) {
      const icao24 = track.icao24.trim().toLowerCase();
      if (!icao24 || track.samples.length === 0) continue;

      const entry = getEntry(icao24, now);
      // The selected aircraft's own, longer history is kept.
      if (icao24 === history.selectedIcao24 && entry.history.length > 0) {
        continue;
      }
      entry.history = track.samples;
      entry.dirty = true;
      changed = true;
    }
    if (changed) {
      emit();
    }
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
    hydrateViewportHistory,
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

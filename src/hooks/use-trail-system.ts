"use client";

import { useEffect } from "react";

import type { FlightTrack, FlightState } from "@/lib/opensky";
import { TRAIL_HISTORY_REFRESH_MS } from "@/lib/trails/constants";
import {
  getDirectTraceProviders,
  fetchReadsbDirectTrack,
} from "@/lib/trails/source/readsb-direct-client";
import { fetchTraceViaProxy } from "@/lib/trails/source/trace-proxy-client";
import {
  trailStore,
  useTrailStoreSnapshot,
} from "@/lib/trails/store/trail-store";
import type { TrailOutcome, TrailProviderId } from "@/lib/trails/types";

function toTrailProviderId(source: string | null): TrailProviderId | null {
  switch (source) {
    case "live":
    case "adsb-fi":
    case "adsb-lol":
    case "airplanes-live":
    case "opensky":
      return source;
    default:
      return null;
  }
}

export function getHistoryLoadDisposition(params: {
  online: boolean;
  hidden: boolean;
  requestInFlight: boolean;
}): "offline" | "hidden" | "in-flight" | "start" {
  if (!params.online) return "offline";
  if (params.hidden) return "hidden";
  if (params.requestInFlight) return "in-flight";
  return "start";
}

export function getHistoryRefreshMs(params: {
  provider: TrailProviderId | null;
  creditsRemaining: number | null;
}): number {
  if (params.provider !== "opensky") return TRAIL_HISTORY_REFRESH_MS;
  if (params.creditsRemaining === null) return TRAIL_HISTORY_REFRESH_MS;
  if (params.creditsRemaining > 200) return TRAIL_HISTORY_REFRESH_MS;
  if (params.creditsRemaining > 50) return 30_000;
  if (params.creditsRemaining > 0) return 60_000;
  return 0;
}

async function fetchSelectedTrack(
  icao24: string,
  signal: AbortSignal,
): Promise<{
  track: FlightTrack | null;
  provider: TrailProviderId | null;
  outcome: TrailOutcome;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
}> {
  for (const provider of getDirectTraceProviders()) {
    const direct = await fetchReadsbDirectTrack(provider, icao24, signal);
    if (direct.track) {
      return {
        track: direct.track,
        provider,
        outcome: direct.outcome,
        creditsRemaining: null,
        retryAfterSeconds: null,
      };
    }
  }

  const proxied = await fetchTraceViaProxy(icao24, signal);
  return {
    track: proxied.track,
    provider: proxied.source,
    outcome: proxied.outcome,
    creditsRemaining: proxied.creditsRemaining,
    retryAfterSeconds: proxied.retryAfterSeconds,
  };
}

export function useTrailSystem(params: {
  flights: FlightState[];
  selectedIcao24: string | null;
  historyEnabled: boolean;
}) {
  const snapshot = useTrailStoreSnapshot((state) => state);

  useEffect(() => {
    trailStore.ingestLiveFlights(params.flights);
  }, [params.flights]);

  useEffect(() => {
    trailStore.selectAircraft(
      params.historyEnabled ? params.selectedIcao24 : null,
    );
  }, [params.historyEnabled, params.selectedIcao24]);

  useEffect(() => {
    const history = trailStore.getSnapshot().history;
    const selectedIcao24 = history.selectedIcao24;
    const selectionGeneration = history.selectionGeneration;

    if (!params.historyEnabled || !selectedIcao24) {
      return;
    }

    let active = true;
    let currentController: AbortController | null = null;
    let timerId: number | null = null;

    const clearTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const scheduleNext = (delayMs: number) => {
      clearTimer();
      if (!active || delayMs <= 0) {
        return;
      }
      timerId = window.setTimeout(() => {
        void load(false);
      }, delayMs);
    };

    const load = async (force: boolean) => {
      if (!active) {
        return;
      }

      const disposition = getHistoryLoadDisposition({
        online: typeof navigator === "undefined" || navigator.onLine,
        hidden: typeof document !== "undefined" && document.hidden,
        requestInFlight: currentController !== null,
      });

      if (disposition === "offline" || disposition === "in-flight") {
        return;
      }

      if (disposition === "hidden") {
        scheduleNext(TRAIL_HISTORY_REFRESH_MS);
        return;
      }

      const latestHistory = trailStore.getSnapshot().history;
      if (
        latestHistory.selectedIcao24 !== selectedIcao24 ||
        latestHistory.selectionGeneration !== selectionGeneration
      ) {
        return;
      }

      const now = Date.now();
      if (!force && latestHistory.cooldownUntil > now) {
        scheduleNext(latestHistory.cooldownUntil - now);
        return;
      }

      trailStore.startHistoryLoad({ selectionGeneration });

      const controller = new AbortController();
      currentController = controller;

      try {
        const result = await fetchSelectedTrack(
          selectedIcao24,
          controller.signal,
        );

        // After an async gap, the effect may have been cleaned up or
        // the selection may have changed.  The generation check in
        // resolveHistory / failHistory guards against stale results,
        // so we only need to bail on scheduling here.
        if (!active) {
          // Still resolve if the generation matches — avoids silently
          // discarding a valid response that would fix the trail.
          const staleCheck = trailStore.getSnapshot().history;
          if (
            staleCheck.selectedIcao24 !== selectedIcao24 ||
            staleCheck.selectionGeneration !== selectionGeneration
          ) {
            return;
          }
        }

        const refreshedHistory = trailStore.getSnapshot().history;
        if (
          refreshedHistory.selectedIcao24 !== selectedIcao24 ||
          refreshedHistory.selectionGeneration !== selectionGeneration
        ) {
          return;
        }

        if (result.track) {
          trailStore.resolveHistory({
            icao24: selectedIcao24,
            selectionGeneration,
            provider: result.provider,
            outcome: result.outcome,
            creditsRemaining: result.creditsRemaining,
            track: result.track,
          });
        } else if (result.outcome === "rate-limited") {
          trailStore.failHistory({
            icao24: selectedIcao24,
            selectionGeneration,
            provider: result.provider,
            outcome: result.outcome,
            creditsRemaining: result.creditsRemaining,
            cooldownUntil: Date.now() + (result.retryAfterSeconds ?? 60) * 1000,
          });
        } else {
          trailStore.resolveHistory({
            icao24: selectedIcao24,
            selectionGeneration,
            provider: toTrailProviderId(result.provider),
            outcome: result.outcome,
            creditsRemaining: result.creditsRemaining,
            track: null,
          });
        }

        // Don't schedule refreshes after the effect has been torn down
        if (!active) {
          return;
        }

        const nextHistory = trailStore.getSnapshot().history;
        const refreshMs = getHistoryRefreshMs({
          provider: nextHistory.provider,
          creditsRemaining: nextHistory.creditsRemaining,
        });
        scheduleNext(refreshMs);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        trailStore.failHistory({
          icao24: selectedIcao24,
          selectionGeneration,
          provider: null,
          outcome: "provider-unavailable",
          cooldownUntil: Date.now() + TRAIL_HISTORY_REFRESH_MS,
        });
        scheduleNext(TRAIL_HISTORY_REFRESH_MS);
      } finally {
        if (currentController === controller) {
          currentController = null;
        }
      }
    };

    const handleOnline = () => {
      void load(true);
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void load(true);
      }
    };

    void load(true);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      clearTimer();
      // Don't abort in-flight fetches — let them complete naturally.
      // resolveHistory/failHistory guard against stale results via
      // selectionGeneration, and completing the fetch avoids the
      // "cancelled request → lost response" race that prevented
      // historical trails from rendering after React re-mounts.
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    params.historyEnabled,
    snapshot.history.selectedIcao24,
    snapshot.history.selectionGeneration,
  ]);

  return snapshot;
}

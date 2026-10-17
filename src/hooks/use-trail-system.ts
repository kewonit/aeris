"use client";

import { useEffect } from "react";

import type { FlightTrack, FlightState } from "@/lib/opensky";
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

/**
 * How often the selected aircraft's history is fetched again. Live samples
 * keep the trail current in between; a refresh only fills earlier gaps.
 */
const HISTORY_REFRESH_MS = 60_000;

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
  if (params.provider !== "opensky") return HISTORY_REFRESH_MS;
  if (params.creditsRemaining === null) return HISTORY_REFRESH_MS;
  if (params.creditsRemaining > 200) return HISTORY_REFRESH_MS;
  if (params.creditsRemaining > 50) return 2 * HISTORY_REFRESH_MS;
  if (params.creditsRemaining > 0) return 5 * HISTORY_REFRESH_MS;
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
    const { selectedIcao24, selectionGeneration } =
      trailStore.getSnapshot().history;

    if (!params.historyEnabled || !selectedIcao24) {
      return;
    }

    let active = true;
    let currentController: AbortController | null = null;
    let timerId: number | null = null;

    const isCurrent = () => {
      const history = trailStore.getSnapshot().history;
      return (
        history.selectedIcao24 === selectedIcao24 &&
        history.selectionGeneration === selectionGeneration
      );
    };

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
        scheduleNext(HISTORY_REFRESH_MS);
        return;
      }

      if (!isCurrent()) {
        return;
      }

      const now = Date.now();
      const { cooldownUntil } = trailStore.getSnapshot().history;
      if (!force && cooldownUntil > now) {
        scheduleNext(cooldownUntil - now);
        return;
      }

      trailStore.startHistoryLoad(selectionGeneration);

      const controller = new AbortController();
      currentController = controller;

      try {
        const result = await fetchSelectedTrack(
          selectedIcao24,
          controller.signal,
        );

        // The fetch is left to finish after cleanup (see below), so the
        // selection may have moved on while it ran.
        if (!isCurrent()) {
          return;
        }

        if (result.outcome === "rate-limited" && !result.track) {
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
            provider: result.provider,
            outcome: result.outcome,
            creditsRemaining: result.creditsRemaining,
            track: result.track,
          });
        }

        if (!active) {
          return;
        }

        const history = trailStore.getSnapshot().history;
        scheduleNext(
          getHistoryRefreshMs({
            provider: history.provider,
            creditsRemaining: history.creditsRemaining,
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        trailStore.failHistory({
          icao24: selectedIcao24,
          selectionGeneration,
          provider: null,
          outcome: "provider-unavailable",
          cooldownUntil: Date.now() + HISTORY_REFRESH_MS,
        });
        scheduleNext(HISTORY_REFRESH_MS);
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
      // In-flight fetches are not aborted: a remount with the same
      // selection would otherwise lose the response and show no history.
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

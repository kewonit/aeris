"use client";

import { useEffect } from "react";

import type { FlightTrack, FlightState } from "@/lib/opensky";
import {
  parseRelayTrackResponse,
  parseRelayTrailsResponse,
  relayHistoryOutcome,
  relayHistoryTrackToSamples,
} from "@/lib/relay/history";
import type {
  RelayBoundingBox,
  RelaySourceStatus,
} from "@/lib/relay/protocol";
import {
  getDirectTraceProviders,
  fetchReadsbDirectTrack,
} from "@/lib/trails/source/readsb-direct-client";
import { fetchTraceViaProxy } from "@/lib/trails/source/trace-proxy-client";
import {
  trailStore,
  useTrailStoreSnapshot,
} from "@/lib/trails/store/trail-store";
import type {
  TrailOutcome,
  TrailProviderId,
  TrailSample,
} from "@/lib/trails/types";

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
  trackId: string | null,
  relayEnabled: boolean,
  signal: AbortSignal,
): Promise<{
  track: FlightTrack | null;
  samples?: TrailSample[];
  provider: TrailProviderId | null;
  outcome: TrailOutcome;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
}> {
  if (relayEnabled) {
    if (!trackId || !/^[A-Za-z0-9_-]{1,128}$/.test(trackId)) {
      return {
        track: null,
        samples: [],
        provider: "aeris-relay",
        outcome: "live-tail-only",
        creditsRemaining: null,
        retryAfterSeconds: null,
      };
    }
    const response = await fetch(
      `/api/tracks/${encodeURIComponent(trackId)}?window=3600&limit=720`,
      { cache: "no-store", signal },
    );
    if (!response.ok) {
      throw new Error(`Relay track request returned ${response.status}`);
    }
    const payload = parseRelayTrackResponse(await response.json());
    if (!payload) throw new Error("Invalid relay track response");
    if (payload.track && payload.track.trackId !== trackId) {
      throw new Error("Relay track response did not match the requested track");
    }
    return {
      track: null,
      samples: payload.track ? relayHistoryTrackToSamples(payload.track) : [],
      provider: "aeris-relay",
      outcome: payload.track
        ? relayHistoryOutcome(payload.meta)
        : "live-tail-only",
      creditsRemaining: null,
      retryAfterSeconds: null,
    };
  }

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
  relayEnabled?: boolean;
  sourceStatus?: RelaySourceStatus | null;
  viewportBbox?: RelayBoundingBox | null;
}) {
  const snapshot = useTrailStoreSnapshot((state) => state);

  useEffect(() => {
    trailStore.ingestLiveFlights(params.flights, {
      authoritativeEmpty:
        params.relayEnabled === true && params.sourceStatus === "live",
    });
  }, [params.flights, params.relayEnabled, params.sourceStatus]);

  useEffect(() => {
    trailStore.selectAircraft(
      params.historyEnabled ? params.selectedIcao24 : null,
    );
  }, [params.historyEnabled, params.selectedIcao24]);

  const viewportKey = params.viewportBbox
    ? [
        params.viewportBbox.west,
        params.viewportBbox.south,
        params.viewportBbox.east,
        params.viewportBbox.north,
      ]
        .map((value) => value.toFixed(4))
        .join(",")
    : null;

  useEffect(() => {
    if (!params.relayEnabled || !viewportKey) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/trails?bbox=${encodeURIComponent(viewportKey)}&window=600&limitPerAircraft=120`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`Relay trails request returned ${response.status}`);
        }
        const payload = parseRelayTrailsResponse(await response.json());
        if (!payload) throw new Error("Invalid relay trails response");
        if (!active) return;

        // An address can have several relay tracks; their samples carry the
        // track identity, so the store keeps them apart.
        const byAddress = new Map<string, TrailSample[]>();
        for (const track of payload.tracks) {
          const icao24 = track.address.trim().toLowerCase();
          byAddress.set(icao24, [
            ...(byAddress.get(icao24) ?? []),
            ...relayHistoryTrackToSamples(track),
          ]);
        }
        trailStore.hydrateViewportHistory(
          [...byAddress].map(([icao24, samples]) => ({
            icao24,
            samples: samples.sort((left, right) => left.t - right.t),
          })),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      } finally {
        if (active) timer = setTimeout(load, 60_000);
      }
    };

    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [params.relayEnabled, viewportKey]);

  const selectedTrackId = params.selectedIcao24
    ? (params.flights.find(
        (flight) => flight.icao24 === params.selectedIcao24,
      )?.trackId ?? null)
    : null;

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
          selectedTrackId,
          params.relayEnabled ?? false,
          controller.signal,
        );

        if (!active || !isCurrent()) {
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
            samples: result.samples,
          });
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
      currentController?.abort();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    params.historyEnabled,
    snapshot.history.selectedIcao24,
    snapshot.history.selectionGeneration,
    selectedTrackId,
    params.relayEnabled,
  ]);

  return snapshot;
}

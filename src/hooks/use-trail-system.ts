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
import type { TrailSegment } from "@/lib/trails/types";
import type {
  RelayBoundingBox,
  RelaySourceStatus,
} from "@/lib/relay/protocol";
import {
  parseRelayTrackResponse,
  parseRelayTrailsResponse,
  relayHistoryOutcome,
  relayHistoryTrackToFlightTrack,
  relayHistoryTrackToSegments,
} from "@/lib/relay/history";

function toTrailProviderId(source: string | null): TrailProviderId | null {
  switch (source) {
    case "live":
    case "adsb-fi":
    case "adsb-lol":
    case "airplanes-live":
    case "opensky":
    case "aeris-relay":
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
  trackId: string | null,
  relayEnabled: boolean,
  signal: AbortSignal,
): Promise<{
  track: FlightTrack | null;
  segments?: TrailSegment[];
  provider: TrailProviderId | null;
  outcome: TrailOutcome;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
}> {
  if (relayEnabled) {
    if (!trackId || !/^[A-Za-z0-9_-]{1,128}$/.test(trackId)) {
      return {
        track: null,
        segments: [],
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
    if (!response.ok) throw new Error(`Relay track request returned ${response.status}`);
    const payload = parseRelayTrackResponse(await response.json());
    if (!payload) throw new Error("Invalid relay track response");
    if (payload.track && payload.track.trackId !== trackId) {
      throw new Error("Relay track response did not match the requested track");
    }
    return {
      track: payload.track ? relayHistoryTrackToFlightTrack(payload.track) : null,
      segments: payload.track ? relayHistoryTrackToSegments(payload.track) : [],
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
        if (!response.ok) throw new Error(`Relay trails request returned ${response.status}`);
        const payload = parseRelayTrailsResponse(await response.json());
        if (!payload) throw new Error("Invalid relay trails response");
        if (!active) return;

        const grouped = new Map<string, TrailSegment[]>();
        for (const track of payload.tracks) {
          const key = track.address.trim().toLowerCase();
          const segments = relayHistoryTrackToSegments(track);
          if (segments.length === 0) continue;
          grouped.set(key, [...(grouped.get(key) ?? []), ...segments]);
        }
        const outcome = relayHistoryOutcome(payload.meta);
        trailStore.hydrateViewportHistory({
          tracks: [...grouped].map(([icao24, segments]) => ({
            icao24,
            segments,
            outcome,
          })),
        });
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
          selectedTrackId,
          params.relayEnabled ?? false,
          controller.signal,
        );

        if (!active) {
          return;
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
            segments: result.segments,
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

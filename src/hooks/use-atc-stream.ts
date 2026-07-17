"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  AtcFeed,
  AtcSourceCandidate,
  AtcSourcesManifest,
  AtcStreamStatus,
} from "@/lib/atc-types";
import {
  getBuiltInAtcSourceId,
  getFeedsByIcao,
} from "@/lib/atc-feeds";
import {
  ATC_STABLE_PLAYBACK_MS,
  buildAtcPlaybackPlan,
  recordAtcSourceFailure,
  recordAtcSourceStableSuccess,
  selectAtcPlaybackCandidate,
  type AtcPlaybackCandidate,
  type AtcPlaybackPlan,
  type AtcSourceHealthById,
} from "@/lib/atc-failover";
import {
  getCachedAtcSources,
  loadAtcSources,
} from "@/lib/atc-source-client";
import {
  isAtcAudioElementCaptured,
  retireAtcAudioElement,
} from "@/lib/atc-audio-analysis";

const VOLUME_STORAGE_KEY = "aeris:atc:volume";
const DEFAULT_VOLUME = 0.7;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const BROADCAST_CHANNEL_NAME = "aeris:atc-playback";
const TRANSIENT_STATUS_DELAY_MS = 1_200;

export const ATC_STARTUP_TIMEOUT_MS = 45_000;
export const ATC_STALL_TIMEOUT_MS = 12_000;

export function getAtcReconnectDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  return Math.min(
    RECONNECT_BASE_MS * Math.pow(2, safeAttempt),
    RECONNECT_MAX_MS,
  );
}

function hasErrorName(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === name
  );
}

export function isAtcAutoplayBlock(error: unknown): boolean {
  return hasErrorName(error, "NotAllowedError");
}

function isAbortError(error: unknown): boolean {
  return hasErrorName(error, "AbortError");
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Reusing the same element preserves WebKit's per-element autoplay grant.
 * An element that may already be captured by Web Audio cannot safely move
 * from a CORS-enabled source to a non-CORS source, because captured media
 * would become silent. Before first playback, no visualizer has captured it.
 */
export function canReuseAtcAudioElement(
  currentAnalyzable: boolean | null,
  nextAnalyzable: boolean,
  mayBeWebAudioCaptured: boolean,
): boolean {
  if (currentAnalyzable === null) return false;
  if (currentAnalyzable === nextAnalyzable) return true;
  if (!currentAnalyzable && nextAnalyzable) return true;
  return !mayBeWebAudioCaptured;
}

export function shouldSwitchToAtcManifestCandidate(
  activeSourceId: string | null,
  preferredSourceId: string | null,
  playbackEstablished: boolean,
): boolean {
  return (
    preferredSourceId !== null &&
    preferredSourceId !== activeSourceId &&
    !playbackEstablished
  );
}

/** Startup buffering is governed by its longer watchdog, not the stall timer. */
export function shouldArmAtcStallTimeout(hasStartedPlaying: boolean): boolean {
  return hasStartedPlaying;
}

function loadVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return DEFAULT_VOLUME;
    const volume = Number(raw);
    return Number.isFinite(volume) && volume >= 0 && volume <= 1
      ? volume
      : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function saveVolume(volume: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  } catch {
    // localStorage may be unavailable.
  }
}

type Timer = ReturnType<typeof setTimeout>;
type TimerRef = { current: Timer | null };

function clearTimer(ref: TimerRef): void {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

type BroadcastMessage =
  | { type: "playing"; tabId: string; feedId: string }
  | { type: "stopped"; tabId: string };

function createTabId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function builtInCandidate(feed: AtcFeed): AtcSourceCandidate {
  const id = getBuiltInAtcSourceId(feed.id);
  return {
    id,
    feedId: feed.id,
    providerId: "liveatc",
    providerLabel: "LiveATC.net",
    attributionUrl: "https://www.liveatc.net/",
    priority: 100,
    analyzable: true,
    playbackUrl: `/api/atc/stream?source=${encodeURIComponent(id)}`,
  };
}

function buildSourcesByFeed(
  feeds: readonly AtcFeed[],
  manifest: AtcSourcesManifest | null,
): Record<string, AtcSourceCandidate[]> {
  return Object.fromEntries(
    feeds.map((catalogFeed) => {
      const configured = manifest?.sourcesByFeed[catalogFeed.id];
      return [
        catalogFeed.id,
        configured && configured.length > 0
          ? configured
          : [builtInCandidate(catalogFeed)],
      ];
    }),
  );
}

function buildPlaybackPlan(
  requestedFeed: AtcFeed,
  manifest: AtcSourcesManifest | null,
): AtcPlaybackPlan {
  const catalog = getFeedsByIcao(requestedFeed.icao);
  return buildAtcPlaybackPlan(
    requestedFeed,
    catalog,
    buildSourcesByFeed(catalog, manifest),
  );
}

export interface UseAtcStreamReturn {
  /** User-selected logical channel. */
  feed: AtcFeed | null;
  /** Channel currently being attempted or played, including facility backup. */
  activeFeed: AtcFeed | null;
  activeSourceId: string | null;
  status: AtcStreamStatus;
  switching: boolean;
  reconnecting: boolean;
  error: string | null;
  retryAt: number | null;
  isBackup: boolean;
  analyzable: boolean;
  volume: number;
  audioElement: HTMLAudioElement | null;
  play: (feed: AtcFeed) => void;
  stop: () => void;
  resume: () => void;
  retry: () => void;
  setVolume: (volume: number) => void;
}

export function useAtcStream(): UseAtcStreamReturn {
  const [feed, setFeed] = useState<AtcFeed | null>(null);
  const [activeFeed, setActiveFeed] = useState<AtcFeed | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [status, setStatus] = useState<AtcStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [isBackup, setIsBackup] = useState(false);
  const [analyzable, setAnalyzable] = useState(false);
  const [volume, setVolumeState] = useState(loadVolume);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(
    null,
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestedFeedRef = useRef<AtcFeed | null>(null);
  const activeCandidateRef = useRef<AtcPlaybackCandidate | null>(null);
  const planRef = useRef<AtcPlaybackPlan | null>(null);
  const healthRef = useRef<AtcSourceHealthById>({});
  const desiredPlaybackRef = useRef(false);
  const volumeRef = useRef(volume);
  const audioGenerationRef = useRef(0);
  const audioAnalyzableRef = useRef<boolean | null>(null);
  const audioConnectionActiveRef = useRef(false);
  const playbackEstablishedRef = useRef(false);
  const manifestPendingRef = useRef(false);
  const audioEventCleanupRef = useRef<(() => void) | null>(null);
  const sessionGenerationRef = useRef(0);
  const startupTimerRef = useRef<Timer | null>(null);
  const stallTimerRef = useRef<Timer | null>(null);
  const transientStatusTimerRef = useRef<Timer | null>(null);
  const stableTimerRef = useRef<Timer | null>(null);
  const retryTimerRef = useRef<Timer | null>(null);
  const tabIdRef = useRef(createTabId());
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const startCandidateRef = useRef<
    (candidate: AtcPlaybackCandidate, phase: "loading" | "switching") => void
  >(() => {});
  const attemptNextRef = useRef<
    (phase: "loading" | "switching" | "reconnecting") => void
  >(() => {});
  const handleSourceFailureRef = useRef<(sourceId: string) => void>(() => {});

  const setPlaybackStatus = useCallback((nextStatus: AtcStreamStatus) => {
    setStatus(nextStatus);
  }, []);

  const updateMediaSession = useCallback(
    (currentFeed: AtcFeed | null, isPlaying: boolean) => {
      if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
        return;
      }

      if (!currentFeed || !isPlaying) {
        navigator.mediaSession.playbackState = "none";
        return;
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentFeed.name,
        artist: `${currentFeed.icao} · ${currentFeed.frequency}`,
        album: "Aeris ATC",
      });
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("pause", () => stopRef.current());
      navigator.mediaSession.setActionHandler("stop", () => stopRef.current());
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    },
    [],
  );

  const clearPlaybackTimers = useCallback(() => {
    clearTimer(startupTimerRef);
    clearTimer(stallTimerRef);
    clearTimer(transientStatusTimerRef);
    clearTimer(stableTimerRef);
  }, []);

  const clearRetryTimer = useCallback(() => {
    clearTimer(retryTimerRef);
  }, []);

  const disposeAudio = useCallback(
    (preserveElement = false): HTMLAudioElement | null => {
      audioGenerationRef.current += 1;
      clearPlaybackTimers();
      audioEventCleanupRef.current?.();
      audioEventCleanupRef.current = null;
      audioConnectionActiveRef.current = false;
      playbackEstablishedRef.current = false;
      updateMediaSession(null, false);

      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }

      if (audio && preserveElement) {
        return audio;
      }

      if (audio) retireAtcAudioElement(audio);

      audioRef.current = null;
      audioAnalyzableRef.current = null;
      setAudioElement(null);
      return null;
    },
    [clearPlaybackTimers, updateMediaSession],
  );

  const scheduleRetry = useCallback(
    (nextRetryAt: number) => {
      clearRetryTimer();
      const delay = Math.max(0, nextRetryAt - Date.now());
      setRetryAt(nextRetryAt);
      setPlaybackStatus("reconnecting");
      setError("All sources unavailable · retrying");

      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (!desiredPlaybackRef.current) return;
        attemptNextRef.current("reconnecting");
      }, delay);
    },
    [clearRetryTimer, setPlaybackStatus],
  );

  const startCandidate = useCallback(
    (
      candidate: AtcPlaybackCandidate,
      phase: "loading" | "switching",
    ) => {
      if (!desiredPlaybackRef.current) return;

      clearRetryTimer();
      const reusableAudio = audioRef.current;
      const canReuse =
        reusableAudio !== null &&
        canReuseAtcAudioElement(
          audioAnalyzableRef.current,
          candidate.source.analyzable,
          isAtcAudioElementCaptured(reusableAudio),
        );
      const audio = disposeAudio(canReuse) ?? new Audio();
      const generation = ++audioGenerationRef.current;
      activeCandidateRef.current = candidate;
      audioRef.current = audio;
      audioAnalyzableRef.current = candidate.source.analyzable;
      setActiveFeed(candidate.feed);
      setActiveSourceId(candidate.source.id);
      setIsBackup(candidate.isBackup);
      setAnalyzable(
        candidate.source.analyzable && !manifestPendingRef.current,
      );
      setRetryAt(null);
      setError(phase === "switching" ? "Switching source…" : null);
      setPlaybackStatus(phase);

      setAudioElement(audio);
      audio.volume = volumeRef.current;
      audio.preload = "none";
      if (candidate.source.analyzable) {
        audio.crossOrigin = "anonymous";
      } else {
        audio.removeAttribute("crossorigin");
      }
      audio.src = candidate.source.playbackUrl;
      audioConnectionActiveRef.current = true;

      let terminalFailureHandled = false;
      let hasStartedPlaying = false;
      const isCurrent = () =>
        desiredPlaybackRef.current &&
        audioGenerationRef.current === generation &&
        audioRef.current === audio;

      const fail = () => {
        if (!isCurrent() || terminalFailureHandled) return;
        terminalFailureHandled = true;
        clearPlaybackTimers();
        handleSourceFailureRef.current(candidate.source.id);
      };

      const armStartupTimeout = () => {
        clearTimer(startupTimerRef);
        startupTimerRef.current = setTimeout(fail, ATC_STARTUP_TIMEOUT_MS);
      };

      const armStallTimeout = () => {
        if (!isCurrent() || terminalFailureHandled) return;
        if (!shouldArmAtcStallTimeout(hasStartedPlaying)) return;
        clearTimer(stableTimerRef);

        if (!transientStatusTimerRef.current) {
          transientStatusTimerRef.current = setTimeout(() => {
            if (!isCurrent()) return;
            setPlaybackStatus("reconnecting");
            setError("Stream interrupted · reconnecting");
          }, TRANSIENT_STATUS_DELAY_MS);
        }

        if (!stallTimerRef.current) {
          stallTimerRef.current = setTimeout(fail, ATC_STALL_TIMEOUT_MS);
        }
      };

      const handlePlaying = () => {
        if (!isCurrent() || terminalFailureHandled) return;
        hasStartedPlaying = true;
        clearTimer(startupTimerRef);
        clearTimer(stallTimerRef);
        clearTimer(transientStatusTimerRef);
        clearTimer(stableTimerRef);
        setPlaybackStatus("playing");
        setError(null);
        setRetryAt(null);
        updateMediaSession(candidate.feed, true);

        stableTimerRef.current = setTimeout(() => {
          if (!isCurrent()) return;
          playbackEstablishedRef.current = true;
          healthRef.current = recordAtcSourceStableSuccess(
            healthRef.current,
            candidate.source.id,
            ATC_STABLE_PLAYBACK_MS,
          );
        }, ATC_STABLE_PLAYBACK_MS);

        try {
          broadcastRef.current?.postMessage({
            type: "playing",
            tabId: tabIdRef.current,
            feedId: requestedFeedRef.current?.id ?? candidate.feed.id,
          } satisfies BroadcastMessage);
        } catch {
          // BroadcastChannel may be closed.
        }
      };

      audio.addEventListener("playing", handlePlaying);
      audio.addEventListener("waiting", armStallTimeout);
      audio.addEventListener("stalled", armStallTimeout);
      audio.addEventListener("error", fail);
      audio.addEventListener("ended", fail);
      audioEventCleanupRef.current = () => {
        audio.removeEventListener("playing", handlePlaying);
        audio.removeEventListener("waiting", armStallTimeout);
        audio.removeEventListener("stalled", armStallTimeout);
        audio.removeEventListener("error", fail);
        audio.removeEventListener("ended", fail);
      };

      armStartupTimeout();
      audio.play().catch((playError: unknown) => {
        if (!isCurrent() || terminalFailureHandled) return;

        if (isAtcAutoplayBlock(playError)) {
          terminalFailureHandled = true;
          clearPlaybackTimers();
          setPlaybackStatus("blocked");
          setError("Tap to listen · browser requires interaction");
          return;
        }

        if (isAbortError(playError)) {
          terminalFailureHandled = true;
          clearPlaybackTimers();
          setPlaybackStatus("reconnecting");
          setError("Reconnecting…");
          const nextRetryAt = Date.now() + getAtcReconnectDelayMs(0);
          setRetryAt(nextRetryAt);
          clearRetryTimer();
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!desiredPlaybackRef.current) return;
            startCandidateRef.current(candidate, "switching");
          }, getAtcReconnectDelayMs(0));
          return;
        }

        fail();
      });
    },
    [
      clearPlaybackTimers,
      clearRetryTimer,
      disposeAudio,
      setPlaybackStatus,
      updateMediaSession,
    ],
  );

  const attemptNext = useCallback(
    (phase: "loading" | "switching" | "reconnecting") => {
      if (!desiredPlaybackRef.current) return;
      const plan = planRef.current;
      if (!plan) return;

      if (isOffline()) {
        clearRetryTimer();
        disposeAudio(true);
        setRetryAt(null);
        setPlaybackStatus("reconnecting");
        setError("Offline · waiting for connection");
        return;
      }

      const selection = selectAtcPlaybackCandidate(
        plan,
        healthRef.current,
        Date.now(),
      );
      if (selection.candidate) {
        startCandidateRef.current(
          selection.candidate,
          phase === "loading" ? "loading" : "switching",
        );
        return;
      }

      disposeAudio(true);
      if (selection.retryAt !== null) {
        scheduleRetry(selection.retryAt);
        return;
      }

      setRetryAt(null);
      setPlaybackStatus("error");
      setError("No ATC sources configured for this airport");
    },
    [clearRetryTimer, disposeAudio, scheduleRetry, setPlaybackStatus],
  );

  const handleSourceFailure = useCallback(
    (sourceId: string) => {
      if (!desiredPlaybackRef.current) return;

      if (isOffline()) {
        disposeAudio(true);
        setRetryAt(null);
        setPlaybackStatus("reconnecting");
        setError("Offline · waiting for connection");
        return;
      }

      healthRef.current = recordAtcSourceFailure(
        healthRef.current,
        sourceId,
        Date.now(),
      );
      setPlaybackStatus("switching");
      setError("Switching source…");
      attemptNextRef.current("switching");
    },
    [disposeAudio, setPlaybackStatus],
  );

  useEffect(() => {
    startCandidateRef.current = startCandidate;
    attemptNextRef.current = attemptNext;
    handleSourceFailureRef.current = handleSourceFailure;
  }, [attemptNext, handleSourceFailure, startCandidate]);

  const clearPlaybackState = useCallback(
    (broadcastStop: boolean) => {
      desiredPlaybackRef.current = false;
      sessionGenerationRef.current += 1;
      clearRetryTimer();
      disposeAudio();
      requestedFeedRef.current = null;
      activeCandidateRef.current = null;
      planRef.current = null;
      manifestPendingRef.current = false;
      setFeed(null);
      setActiveFeed(null);
      setActiveSourceId(null);
      setRetryAt(null);
      setIsBackup(false);
      setAnalyzable(false);
      setError(null);
      setPlaybackStatus("idle");
      updateMediaSession(null, false);

      if (!broadcastStop) return;
      try {
        broadcastRef.current?.postMessage({
          type: "stopped",
          tabId: tabIdRef.current,
        } satisfies BroadcastMessage);
      } catch {
        // BroadcastChannel may be closed.
      }
    },
    [clearRetryTimer, disposeAudio, setPlaybackStatus, updateMediaSession],
  );

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastRef.current = channel;
    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const message = event.data;
      if (
        message?.type === "playing" &&
        message.tabId !== tabIdRef.current &&
        desiredPlaybackRef.current
      ) {
        clearPlaybackState(false);
      }
    };

    return () => {
      channel.close();
      if (broadcastRef.current === channel) broadcastRef.current = null;
    };
  }, [clearPlaybackState]);

  const play = useCallback((nextFeed: AtcFeed) => {
    const sessionGeneration = ++sessionGenerationRef.current;
    desiredPlaybackRef.current = true;
    requestedFeedRef.current = nextFeed;
    setFeed(nextFeed);
    setError(null);
    setRetryAt(null);

    const cachedManifest = getCachedAtcSources(nextFeed.icao);
    manifestPendingRef.current = cachedManifest === null;
    planRef.current = buildPlaybackPlan(nextFeed, cachedManifest);
    attemptNextRef.current("loading");

    void loadAtcSources(nextFeed.icao)
      .then((manifest) => {
        if (
          !desiredPlaybackRef.current ||
          sessionGenerationRef.current !== sessionGeneration ||
          requestedFeedRef.current?.id !== nextFeed.id
        ) {
          return;
        }

        const authoritativePlan = buildPlaybackPlan(nextFeed, manifest);
        manifestPendingRef.current = false;
        planRef.current = authoritativePlan;
        if (!audioConnectionActiveRef.current) {
          attemptNextRef.current("switching");
          return;
        }

        const preferred = selectAtcPlaybackCandidate(
          authoritativePlan,
          healthRef.current,
          Date.now(),
        ).candidate;
        if (
          shouldSwitchToAtcManifestCandidate(
            activeCandidateRef.current?.source.id ?? null,
            preferred?.source.id ?? null,
            playbackEstablishedRef.current,
          ) &&
          preferred
        ) {
          startCandidateRef.current(preferred, "switching");
        } else {
          setAnalyzable(
            activeCandidateRef.current?.source.analyzable ?? false,
          );
        }
      })
      .catch(() => {
        if (
          desiredPlaybackRef.current &&
          sessionGenerationRef.current === sessionGeneration &&
          requestedFeedRef.current?.id === nextFeed.id
        ) {
          manifestPendingRef.current = false;
          setAnalyzable(
            activeCandidateRef.current?.source.analyzable ?? false,
          );
        }
        // Built-in LiveATC candidates remain available without the manifest.
      });
  }, []);

  const stop = useCallback(() => {
    clearPlaybackState(true);
  }, [clearPlaybackState]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const resume = useCallback(() => {
    const candidate = activeCandidateRef.current;
    if (!desiredPlaybackRef.current || !candidate) return;
    startCandidateRef.current(candidate, "loading");
  }, []);

  const retry = useCallback(() => {
    if (!desiredPlaybackRef.current || !planRef.current) return;

    healthRef.current = Object.fromEntries(
      Object.entries(healthRef.current).map(([sourceId, sourceHealth]) => [
        sourceId,
        sourceHealth
          ? { ...sourceHealth, cooldownUntil: 0 }
          : sourceHealth,
      ]),
    );
    clearRetryTimer();
    disposeAudio(true);
    attemptNextRef.current("switching");

    const requestedFeed = requestedFeedRef.current;
    if (requestedFeed) {
      void loadAtcSources(requestedFeed.icao, { force: true })
        .then((manifest) => {
          if (
            !desiredPlaybackRef.current ||
            requestedFeedRef.current?.id !== requestedFeed.id
          ) {
            return;
          }
          planRef.current = buildPlaybackPlan(requestedFeed, manifest);
        })
        .catch(() => {});
    }
  }, [clearRetryTimer, disposeAudio]);

  const setVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    saveVolume(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      if (!desiredPlaybackRef.current || audioConnectionActiveRef.current) {
        return;
      }
      clearRetryTimer();
      setRetryAt(null);
      attemptNextRef.current("reconnecting");
    };
    const handleOffline = () => {
      if (!desiredPlaybackRef.current) return;
      disposeAudio(true);
      clearRetryTimer();
      setRetryAt(null);
      setPlaybackStatus("reconnecting");
      setError("Offline · waiting for connection");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [clearRetryTimer, disposeAudio, setPlaybackStatus]);

  useEffect(() => {
    return () => {
      desiredPlaybackRef.current = false;
      clearRetryTimer();
      disposeAudio();
      updateMediaSession(null, false);
    };
  }, [clearRetryTimer, disposeAudio, updateMediaSession]);

  return {
    feed,
    activeFeed,
    activeSourceId,
    status,
    switching: status === "switching",
    reconnecting: status === "reconnecting",
    error,
    retryAt,
    isBackup,
    analyzable,
    volume,
    audioElement,
    play,
    stop,
    resume,
    retry,
    setVolume,
  };
}

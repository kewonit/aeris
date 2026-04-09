"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AtcFeed, AtcStreamStatus } from "@/lib/atc-types";
import { VALID_MOUNT_POINTS } from "@/lib/atc-feeds";

// ── Constants ──────────────────────────────────────────────────────────

const VOLUME_STORAGE_KEY = "aeris:atc:volume";
const DEFAULT_VOLUME = 0.7;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const BROADCAST_CHANNEL_NAME = "aeris:atc-playback";

// ── Volume persistence ─────────────────────────────────────────────────

function loadVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return DEFAULT_VOLUME;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function saveVolume(v: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(v));
  } catch {
    // localStorage may be unavailable
  }
}

// ── BroadcastChannel for single-tab playback ───────────────────────────

type BroadcastMessage =
  | { type: "playing"; tabId: string; feedId: string }
  | { type: "stopped"; tabId: string };

function createTabId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Hook ───────────────────────────────────────────────────────────────

export interface UseAtcStreamReturn {
  /** Currently active feed */
  feed: AtcFeed | null;
  /** Playback status */
  status: AtcStreamStatus;
  /** Error message (when status is 'error' or 'blocked') */
  error: string | null;
  /** Whether proxy fallback is active */
  usingProxy: boolean;
  /** Current volume 0–1 */
  volume: number;
  /** Reference to the underlying HTMLAudioElement (for Web Audio API) */
  audioElement: HTMLAudioElement | null;
  /** Start playing a feed */
  play: (feed: AtcFeed) => void;
  /** Stop playback */
  stop: () => void;
  /** Resume after browser autoplay block (requires user gesture) */
  resume: () => void;
  /** Set volume 0–1 */
  setVolume: (v: number) => void;
}

export function useAtcStream(): UseAtcStreamReturn {
  const [feed, setFeed] = useState<AtcFeed | null>(null);
  const [status, setStatus] = useState<AtcStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [usingProxy, setUsingProxy] = useState(false);
  const [volume, setVolumeState] = useState(loadVolume);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(
    null,
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const feedRef = useRef<AtcFeed | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const tabIdRef = useRef<string>(createTabId());
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proxyAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});
  const startPlaybackRef = useRef<
    (targetFeed: AtcFeed, useProxy?: boolean, isReconnect?: boolean) => void
  >(() => {});

  // ── Cleanup helper ─────────────────────────────────────────────────

  const cleanupAudio = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (stalledTimerRef.current) {
      clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = null;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load(); // release internal resources
      audioRef.current = null;
    }

    setAudioElement(null);
    reconnectAttemptsRef.current = 0;
    proxyAttemptedRef.current = false;
  }, []);

  const clearPlaybackState = useCallback(
    (broadcastStop: boolean) => {
      stoppedManuallyRef.current = true;
      cleanupAudio();
      setFeed(null);
      feedRef.current = null;
      setStatus("idle");
      setError(null);
      setUsingProxy(false);

      if (!broadcastStop) {
        return;
      }

      try {
        broadcastRef.current?.postMessage({
          type: "stopped",
          tabId: tabIdRef.current,
        } satisfies BroadcastMessage);
      } catch {
        // BroadcastChannel may be closed
      }
    },
    [cleanupAudio],
  );

  // ── BroadcastChannel setup ─────────────────────────────────────────

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastRef.current = bc;

    bc.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object" || !msg.type) return;

      // Another tab started playing — stop our playback
      if (
        msg.type === "playing" &&
        msg.tabId !== tabIdRef.current &&
        audioRef.current
      ) {
        clearPlaybackState(false);
      }
    };

    return () => {
      bc.close();
      broadcastRef.current = null;
    };
  }, [clearPlaybackState]);

  // ── Media Session API ──────────────────────────────────────────────

  const updateMediaSession = useCallback(
    (activeFeed: AtcFeed | null, isPlaying: boolean) => {
      if (typeof navigator === "undefined" || !("mediaSession" in navigator))
        return;

      if (!activeFeed || !isPlaying) {
        navigator.mediaSession.playbackState = "none";
        return;
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeFeed.name,
        artist: `${activeFeed.icao} · ${activeFeed.frequency}`,
        album: "Aeris ATC",
      });

      navigator.mediaSession.playbackState = "playing";

      navigator.mediaSession.setActionHandler("pause", () => {
        stopRef.current();
      });

      navigator.mediaSession.setActionHandler("stop", () => {
        stopRef.current();
      });

      // No seek/track actions for live streams
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    },
    [],
  );

  // ── Reconnection logic ────────────────────────────────────────────

  const scheduleReconnectAttempt = useCallback(
    (targetFeed: AtcFeed, useProxy: boolean) => {
      if (stoppedManuallyRef.current) return;

      // Give up after too many failures
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setStatus("error");
        setError("Feed unavailable. Try another frequency.");
        return;
      }

      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, attempt),
        RECONNECT_MAX_MS,
      );

      // Don't flash status — keep the error visible while we wait
      reconnectTimerRef.current = setTimeout(() => {
        if (feedRef.current?.id !== targetFeed.id) return;
        startPlaybackRef.current(targetFeed, useProxy, true);
      }, delay);
    },
    [],
  );

  // ── Core playback ─────────────────────────────────────────────────

  const startPlayback = useCallback(
    (
      targetFeed: AtcFeed,
      useProxy: boolean = false,
      isReconnect: boolean = false,
    ) => {
      cleanupAudio();
      stoppedManuallyRef.current = false;

      const audio = new Audio();
      audioRef.current = audio;
      setAudioElement(audio);
      audio.volume = loadVolume();
      // Allow audio to play in background — do NOT add visibility listeners
      audio.preload = "none";

      // Build stream URL
      let src: string;
      if (useProxy) {
        // Same-origin proxy — enable CORS for Web Audio API analysis
        audio.crossOrigin = "anonymous";
        // Validate mount point exists in our allowlist before proxying
        if (!VALID_MOUNT_POINTS.has(targetFeed.mountPoint)) {
          setStatus("error");
          setError("Invalid feed configuration.");
          return;
        }
        src = `/api/atc/stream?mount=${encodeURIComponent(targetFeed.mountPoint)}`;
        setUsingProxy(true);
      } else {
        src = targetFeed.streamUrl;
        setUsingProxy(false);
      }

      // Only flash "loading" on fresh plays, not silent reconnects
      if (!isReconnect) {
        setStatus("loading");
        setError(null);
      }

      audio.src = src;

      audio.addEventListener("playing", () => {
        if (audioRef.current !== audio) return;
        // Clear any pending stall timer
        if (stalledTimerRef.current) {
          clearTimeout(stalledTimerRef.current);
          stalledTimerRef.current = null;
        }
        setStatus("playing");
        setError(null);
        reconnectAttemptsRef.current = 0;
        updateMediaSession(targetFeed, true);

        // Notify other tabs
        try {
          broadcastRef.current?.postMessage({
            type: "playing",
            tabId: tabIdRef.current,
            feedId: targetFeed.id,
          } satisfies BroadcastMessage);
        } catch {
          // BroadcastChannel may be closed
        }
      });

      audio.addEventListener("waiting", () => {
        if (audioRef.current !== audio) return;
        // Debounce — only show "loading" if buffering persists >1.2s
        if (!stalledTimerRef.current) {
          stalledTimerRef.current = setTimeout(() => {
            stalledTimerRef.current = null;
            if (audioRef.current === audio) setStatus("loading");
          }, 1200);
        }
      });

      audio.addEventListener("error", () => {
        if (audioRef.current !== audio) return;

        // If direct playback failed, try proxy fallback
        if (!useProxy && !proxyAttemptedRef.current) {
          proxyAttemptedRef.current = true;
          setError("Direct stream blocked. Trying proxy...");
          startPlaybackRef.current(targetFeed, true);
          return;
        }

        // Both direct and proxy failed — stay in "error" (not "blocked")
        setUsingProxy(useProxy);
        setStatus("error");

        if (proxyAttemptedRef.current && useProxy) {
          setError("Stream unavailable — try another frequency.");
        } else {
          setError("Stream connection failed.");
        }

        // Try to reconnect (silently, up to MAX_RECONNECT_ATTEMPTS)
        scheduleReconnectAttempt(targetFeed, useProxy);
      });

      audio.addEventListener("stalled", () => {
        if (audioRef.current !== audio) return;
        // Debounce — only show "loading" if stall persists >1.2s
        if (!stalledTimerRef.current) {
          stalledTimerRef.current = setTimeout(() => {
            stalledTimerRef.current = null;
            if (audioRef.current === audio) setStatus("loading");
          }, 1200);
        }
      });

      audio.addEventListener("ended", () => {
        if (audioRef.current !== audio) return;
        // Live streams shouldn't end, but if they do, reconnect
        scheduleReconnectAttempt(targetFeed, useProxy);
      });

      // Start playback — requires user gesture (handled by UI click)
      audio.play().catch(() => {
        // Autoplay blocked — user must interact first
        if (audioRef.current !== audio) return;
        setStatus("blocked");
        setError("Tap to listen — browser requires interaction.");
      });
    },
    [cleanupAudio, scheduleReconnectAttempt, updateMediaSession],
  );

  // ── Public API ────────────────────────────────────────────────────

  const play = useCallback(
    (newFeed: AtcFeed) => {
      feedRef.current = newFeed;
      setFeed(newFeed);
      proxyAttemptedRef.current = false;
      stoppedManuallyRef.current = false;
      startPlayback(newFeed, false);
    },
    [startPlayback],
  );

  const stop = useCallback(() => {
    clearPlaybackState(true);
    updateMediaSession(null, false);
  }, [clearPlaybackState, updateMediaSession]);

  useEffect(() => {
    startPlaybackRef.current = startPlayback;
  }, [startPlayback]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    saveVolume(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  // Resume after autoplay block — must be called from a user gesture
  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setStatus("loading");
    setError(null);
    audio.play().catch(() => {
      setStatus("blocked");
      setError("Tap to listen — browser requires interaction.");
    });
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cleanupAudio();
      updateMediaSession(null, false);
    };
  }, [cleanupAudio, updateMediaSession]);

  return {
    feed,
    status,
    error,
    usingProxy,
    volume,
    audioElement,
    play,
    stop,
    resume,
    setVolume,
  };
}

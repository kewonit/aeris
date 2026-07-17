"use client";

interface CapturedAudioConnection {
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  consumers: number;
  playing: boolean;
  cleanupLifecycle: () => void;
}

let sharedContext: AudioContext | null = null;
let playingCapturedElements = 0;
let resumeListenersInstalled = false;
let contextTransition = Promise.resolve();

const capturedElements = new WeakMap<
  HTMLAudioElement,
  CapturedAudioConnection
>();

function reconcileSharedContext(): void {
  // Serialize opposite transitions. A rapid failover can request resume while
  // suspend() is still pending, so each pass re-checks the desired state after
  // the previous browser transition completes.
  contextTransition = contextTransition
    .catch(() => {})
    .then(async () => {
      const context = sharedContext;
      while (context && context === sharedContext && context.state !== "closed") {
        const shouldRun = playingCapturedElements > 0;
        if (shouldRun && context.state === "suspended") {
          try {
            await context.resume();
          } catch {
            return;
          }
          continue;
        }
        if (!shouldRun && context.state === "running") {
          try {
            await context.suspend();
          } catch {
            return;
          }
          continue;
        }
        return;
      }
    });
}

function setConnectionPlaying(
  connection: CapturedAudioConnection,
  playing: boolean,
): void {
  if (connection.playing === playing) return;
  connection.playing = playing;
  playingCapturedElements = Math.max(
    0,
    playingCapturedElements + (playing ? 1 : -1),
  );

  reconcileSharedContext();
}

function installResumeListeners(): void {
  if (
    resumeListenersInstalled ||
    typeof document === "undefined" ||
    typeof window === "undefined"
  ) {
    return;
  }

  const resumeIfAudible = () => {
    if (
      playingCapturedElements > 0 &&
      document.visibilityState === "visible"
    ) {
      reconcileSharedContext();
    }
  };

  document.addEventListener("visibilitychange", resumeIfAudible);
  window.addEventListener("focus", resumeIfAudible);
  window.addEventListener("pageshow", resumeIfAudible);
  resumeListenersInstalled = true;
}

/**
 * Capture a media element once and share its analyser between visualizers.
 * The graph remains connected while that element is playing, even when a
 * layout such as FPV temporarily unmounts every visualizer.
 */
export function getOrCreateAtcAudioConnection(
  audioElement: HTMLAudioElement,
): AnalyserNode | null {
  installResumeListeners();

  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = new AudioContext();
  }

  const existing = capturedElements.get(audioElement);
  if (existing) {
    existing.consumers += 1;
    if (!audioElement.paused && !audioElement.ended) {
      setConnectionPlaying(existing, true);
    }
    reconcileSharedContext();
    return existing.analyser;
  }

  try {
    const source = sharedContext.createMediaElementSource(audioElement);
    const analyser = sharedContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyser.connect(sharedContext.destination);

    const connection: CapturedAudioConnection = {
      source,
      analyser,
      consumers: 1,
      playing: false,
      cleanupLifecycle: () => {},
    };
    const handlePlay = () => setConnectionPlaying(connection, true);
    const handleStop = () => setConnectionPlaying(connection, false);
    audioElement.addEventListener("play", handlePlay);
    audioElement.addEventListener("playing", handlePlay);
    audioElement.addEventListener("pause", handleStop);
    audioElement.addEventListener("ended", handleStop);
    audioElement.addEventListener("emptied", handleStop);
    connection.cleanupLifecycle = () => {
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("playing", handlePlay);
      audioElement.removeEventListener("pause", handleStop);
      audioElement.removeEventListener("ended", handleStop);
      audioElement.removeEventListener("emptied", handleStop);
    };

    capturedElements.set(audioElement, connection);
    if (!audioElement.paused && !audioElement.ended) {
      setConnectionPlaying(connection, true);
    } else {
      reconcileSharedContext();
    }
    return analyser;
  } catch {
    return null;
  }
}

/** Release one visualizer without disconnecting audible background playback. */
export function releaseAtcAudioConnection(
  audioElement: HTMLAudioElement,
): void {
  const connection = capturedElements.get(audioElement);
  if (!connection) return;
  connection.consumers = Math.max(0, connection.consumers - 1);
  if (connection.consumers === 0 && !connection.playing) {
    reconcileSharedContext();
  }
}

/** True once this element has been permanently routed through Web Audio. */
export function isAtcAudioElementCaptured(
  audioElement: HTMLAudioElement,
): boolean {
  return capturedElements.has(audioElement);
}

/**
 * Disconnect a discarded element so repeated failovers do not retain old
 * Web Audio graphs for the rest of the page lifetime.
 */
export function retireAtcAudioElement(
  audioElement: HTMLAudioElement,
): void {
  const connection = capturedElements.get(audioElement);
  if (!connection) return;

  setConnectionPlaying(connection, false);
  connection.cleanupLifecycle();
  connection.source.disconnect();
  connection.analyser.disconnect();
  capturedElements.delete(audioElement);
  reconcileSharedContext();
}

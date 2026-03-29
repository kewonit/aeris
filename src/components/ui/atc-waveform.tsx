"use client";

import { useRef, useEffect } from "react";

const DEFAULT_BAR_COUNT = 12;
const BAR_WIDTH = 2.5;
const BAR_GAP = 2;
const MIN_BAR_H = 2.5;
const LERP = 0.22;

// ── Module-level Web Audio singleton ────────────────────────────────
// A single AudioContext and WeakMap of captured elements survive across
// component mounts/unmounts. This prevents:
//   1. InvalidStateError from double-capturing the same <audio> element
//   2. AudioContext leak (Chrome limits ~6 concurrent contexts)
let sharedCtx: AudioContext | null = null;

const capturedElements = new WeakMap<
  HTMLAudioElement,
  { source: MediaElementAudioSourceNode; analyser: AnalyserNode }
>();

export function getOrCreateConnection(
  audioElement: HTMLAudioElement,
): AnalyserNode | null {
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioContext();
  }
  if (sharedCtx.state === "suspended") {
    sharedCtx.resume().catch(() => {});
  }

  const existing = capturedElements.get(audioElement);
  if (existing) return existing.analyser;

  try {
    const source = sharedCtx.createMediaElementSource(audioElement);
    const analyser = sharedCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyser.connect(sharedCtx.destination);
    capturedElements.set(audioElement, { source, analyser });
    return analyser;
  } catch {
    return null;
  }
}

/**
 * Build bin ranges that spread bars across the voice-relevant spectrum.
 *
 * ATC audio is narrow-band voice (300–3 400 Hz).  Icecast streams are
 * typically 8–16 kHz MP3 decoded to 44 100 Hz by the browser, so real
 * content lives in the lower ~20–25 % of FFT bins.  We restrict mapping
 * to bins 1–maxBin (skip DC at bin 0) and distribute bars evenly so
 * every bar picks up voice energy.
 */
function buildBinRanges(
  binCount: number,
  barCount: number,
): [number, number][] {
  // Only use the lower portion where voice/content actually lives
  // For 128 bins at 44100 Hz: bin 30 ≈ 5 160 Hz — covers voice + harmonics
  const maxBin = Math.min(Math.ceil(binCount * 0.25), binCount);
  const usable = maxBin - 1; // bins 1..maxBin
  const ranges: [number, number][] = [];
  for (let i = 0; i < barCount; i++) {
    const start = 1 + Math.floor((i / barCount) * usable);
    const end = 1 + Math.floor(((i + 1) / barCount) * usable);
    ranges.push([start, Math.max(end, start + 1)]);
  }
  return ranges;
}

/**
 * ElevenLabs-style audio-reactive waveform.
 *
 * Reads frequency data from a Web Audio AnalyserNode connected to
 * the given <audio> element, then draws smooth rounded bars on a
 * tiny canvas.  When no signal is present the bars settle to their
 * minimum height with a dim tint.
 */
export function AtcWaveform({
  audioElement,
  active,
}: {
  audioElement: HTMLAudioElement | null;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const barsRef = useRef<number[]>(new Array(DEFAULT_BAR_COUNT).fill(0));
  /** Tracks canvas CSS size → derive bar count dynamically */
  const layoutRef = useRef({
    w: DEFAULT_BAR_COUNT * BAR_WIDTH + (DEFAULT_BAR_COUNT - 1) * BAR_GAP,
    h: 28,
    barCount: DEFAULT_BAR_COUNT,
  });

  // ── Connect to Web Audio API ──────────────────────────────────────
  useEffect(() => {
    if (!active || !audioElement) {
      barsRef.current = new Array(layoutRef.current.barCount).fill(0);
      analyserRef.current = null;
      return;
    }

    analyserRef.current = getOrCreateConnection(audioElement);

    // Resume AudioContext when tab returns from background.
    function onVisibilityResume() {
      if (
        document.visibilityState === "visible" &&
        sharedCtx?.state === "suspended"
      ) {
        sharedCtx.resume().catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVisibilityResume);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityResume);
    };
  }, [active, audioElement]);

  // ── Animation loop (always runs — idle or active) ────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw2d = canvas.getContext("2d");
    if (!draw2d) return;

    /** Recompute canvas backing-store size from CSS dimensions. */
    function syncCanvasSize() {
      if (!canvas || !draw2d) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 1 || h < 1) return;

      const barCount = Math.max(
        4,
        Math.floor((w + BAR_GAP) / (BAR_WIDTH + BAR_GAP)),
      );
      layoutRef.current = { w, h, barCount };

      // Resize bars array when count changes
      if (barsRef.current.length !== barCount) {
        barsRef.current = new Array(barCount).fill(0);
      }

      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      draw2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    syncCanvasSize();

    const ro = new ResizeObserver(() => syncCanvasSize());
    ro.observe(canvas);

    // Hoist allocations out of draw loop — only reallocate when binCount changes
    let dataArray: Uint8Array<ArrayBuffer> | null = null;
    let binRanges: [number, number][] | null = null;
    let lastBinCount = 0;
    let lastBarCount = 0;

    function draw() {
      rafRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const analyser = analyserRef.current;
      const binCount = analyser?.frequencyBinCount ?? 128;
      const { w: cW, h: cH, barCount } = layoutRef.current;

      if (binCount !== lastBinCount || barCount !== lastBarCount) {
        dataArray = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
        binRanges = buildBinRanges(binCount, barCount);
        lastBinCount = binCount;
        lastBarCount = barCount;
      }
      if (analyser && dataArray) analyser.getByteFrequencyData(dataArray);

      draw2d!.clearRect(0, 0, cW, cH);

      // Compute theme once per frame (not per bar)
      const isDark = document.documentElement.classList.contains("dark");
      const idleFill = isDark
        ? "rgba(255, 255, 255, 0.1)"
        : "rgba(0, 0, 0, 0.1)";

      for (let i = 0; i < barCount; i++) {
        // Average frequency bins in this bar's range
        const [startBin, endBin] = binRanges![i];
        let sum = 0;
        const count = endBin - startBin;
        for (let b = startBin; b < endBin; b++) {
          sum += dataArray![b];
        }
        const raw = analyser && count > 0 ? sum / count / 255 : 0;

        // Idle breathing: gentle sine wave per bar when no signal
        const breathPhase = (now / 1200 + i * 0.35) % (Math.PI * 2);
        const breathVal = 0.08 + Math.sin(breathPhase) * 0.05;
        const target = raw > 0.02 ? raw : breathVal;

        barsRef.current[i] += (target - barsRef.current[i]) * LERP;
        const val = barsRef.current[i];

        const barH = Math.max(MIN_BAR_H, val * (cH - 2));
        const x = i * (BAR_WIDTH + BAR_GAP);
        const y = cH - barH;

        // Emerald when signal, dim fill when idle
        if (raw > 0.04) {
          const intensity = Math.min(val * 1.6, 1);
          draw2d!.fillStyle = `rgba(52, 211, 153, ${0.5 + intensity * 0.5})`;
        } else {
          draw2d!.fillStyle = idleFill;
        }
        draw2d!.beginPath();
        draw2d!.roundRect(x, y, BAR_WIDTH, barH, 1);
        draw2d!.fill();
      }
    }

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-6 w-10 shrink-0 sm:h-7 sm:w-13"
      aria-hidden="true"
    />
  );
}

"use client";

import { useEffect, useRef } from "react";
import {
  getOrCreateConnection,
  releaseAudioConnection,
} from "@/components/ui/atc-waveform";

const FRAME_MS = 1000 / 60;
/** Voice lives in the lowest quarter of the analyser's bins; see atc-waveform. */
const VOICE_BINS = 0.25;
const ATTACK = 0.35;
const RELEASE = 0.06;
/** Layers of the wave: frequency, speed, weight and opacity. */
const LAYERS = [
  { f: 1.6, s: 1.1, w: 1, a: 1, line: 2 },
  { f: 2.3, s: -0.8, w: 0.62, a: 0.38, line: 1.5 },
  { f: 3.4, s: 1.7, w: 0.38, a: 0.22, line: 1.25 },
] as const;

/**
 * A calm wave that swells while someone is on frequency and settles to a
 * slow breath in the gaps. It reads the stream through the shared Web Audio
 * analyser, so it only moves for the same-origin proxy stream.
 */
export function VoiceWave({
  audioElement,
  active,
  onLevel,
  className = "",
}: {
  audioElement: HTMLAudioElement | null;
  active: boolean;
  /** Called with whether a voice is on frequency, when that changes. */
  onLevel?: (speaking: boolean) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onLevelRef = useRef(onLevel);

  useEffect(() => {
    onLevelRef.current = onLevel;
  }, [onLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const analyser = active && audioElement ? getOrCreateConnection(audioElement) : null;
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // Colours come from the theme through CSS, so the wave matches the card.
    const style = getComputedStyle(canvas);
    const tint = style.color;
    const rest = style.getPropertyValue("--subtle").trim() || tint;

    let level = 0;
    let speaking = false;
    let phase = 0;
    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      const dt = Math.min(now - last, 100) / 1000;
      last = now;

      let target = 0;
      if (analyser && bins) {
        analyser.getByteFrequencyData(bins);
        const end = Math.max(2, Math.floor(bins.length * VOICE_BINS));
        let sum = 0;
        for (let i = 1; i < end; i++) sum += bins[i];
        target = Math.min(1, Math.max(0, (sum / (end - 1) / 255 - 0.08) * 2.4));
      }
      level += (target - level) * (target > level ? ATTACK : RELEASE);
      const nowSpeaking = level > 0.12;
      if (nowSpeaking !== speaking) {
        speaking = nowSpeaking;
        onLevelRef.current?.(speaking);
      }
      if (!reduced) phase += dt * (1.2 + level * 2.2);

      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;
      const breath = active ? 0.06 + 0.03 * Math.sin(now / 1400) : 0.02;
      const amplitude = (breath + level * 0.9) * (mid - 3);
      const steps = Math.max(24, Math.round(width / 3));

      for (let l = LAYERS.length - 1; l >= 0; l--) {
        const layer = LAYERS[l];
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          // Taper to the ends so the wave rests on a line, like a held breath.
          const envelope = Math.pow(Math.sin(Math.PI * t), 2.2);
          const y =
            mid +
            Math.sin(t * Math.PI * 2 * layer.f + phase * layer.s) *
              amplitude *
              layer.w *
              envelope;
          if (i === 0) ctx.moveTo(t * width, y);
          else ctx.lineTo(t * width, y);
        }
        ctx.strokeStyle = l === 0 && active ? tint : rest;
        ctx.globalAlpha = l === 0 ? (active ? 1 : 0.5) : layer.a;
        ctx.lineWidth = layer.line;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (analyser) releaseAudioConnection();
      if (speaking) onLevelRef.current?.(false);
    };
  }, [active, audioElement]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`block text-tint ${className}`} />;
}

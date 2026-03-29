"use client";

import { useRef, useEffect, useState } from "react";
import { motion } from "motion/react";
import { getOrCreateConnection } from "@/components/ui/atc-waveform";

// ── Constants ──────────────────────────────────────────────────────────

const BAR_COUNT = 64;
const CANVAS_PADDING = 20;
const LERP_UP = 0.24; // Quick attack
const LERP_DOWN = 0.07; // Slow decay — silky smooth

type VisualizationMode = "spectrum" | "waveform" | "combined";

const MODES: { key: VisualizationMode; label: string }[] = [
  { key: "spectrum", label: "Spectrum" },
  { key: "waveform", label: "Waveform" },
  { key: "combined", label: "Combined" },
];

// ── Voice-range bin mapping (logarithmic spread) ───────────────────────

function buildBinRanges(
  binCount: number,
  barCount: number,
): [number, number][] {
  const maxBin = Math.min(Math.ceil(binCount * 0.35), binCount);
  const ranges: [number, number][] = [];
  for (let i = 0; i < barCount; i++) {
    const t0 = i / barCount;
    const t1 = (i + 1) / barCount;
    const start = 1 + Math.floor(t0 * t0 * (maxBin - 1));
    const end = 1 + Math.floor(t1 * t1 * (maxBin - 1));
    ranges.push([start, Math.max(end, start + 1)]);
  }
  return ranges;
}

// ── Accent color helper ────────────────────────────────────────────────

function accent(intensity: number, alpha: number): string {
  const v = Math.min(intensity, 1);
  // Refined emerald/mint — clean and cohesive
  const r = Math.round(48 + v * 40);
  const g = Math.round(205 + v * 35);
  const b = Math.round(148 + v * 32);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Segmented Control (Apple-style) ────────────────────────────────────

function SegmentedControl({
  mode,
  onChange,
}: {
  mode: VisualizationMode;
  onChange: (m: VisualizationMode) => void;
}) {
  const activeIndex = MODES.findIndex((m) => m.key === mode);
  const segW = 100 / MODES.length;

  return (
    <div
      role="tablist"
      className="relative flex h-6.5 shrink-0 items-center rounded-lg"
      style={{ backgroundColor: "rgb(var(--ui-fg) / 0.06)" }}
    >
      {/* Sliding capsule indicator */}
      <motion.div
        className="absolute top-0.5 bottom-0.5 rounded-md"
        style={{
          width: `calc(${segW}% - 4px)`,
          backgroundColor: "rgb(var(--ui-fg) / 0.1)",
          boxShadow:
            "0 1px 2px rgb(0 0 0 / 0.25), inset 0 0.5px 0 rgb(var(--ui-fg) / 0.05)",
        }}
        animate={{ left: `calc(${activeIndex * segW}% + 2px)` }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
      />
      {MODES.map((m) => (
        <button
          key={m.key}
          role="tab"
          type="button"
          aria-selected={mode === m.key}
          onClick={() => onChange(m.key)}
          className="relative z-10 flex h-full flex-1 items-center justify-center px-2.5 text-[10px] font-semibold tracking-wide transition-colors duration-200"
          style={{
            color:
              mode === m.key
                ? "rgb(var(--ui-fg) / 0.9)"
                : "rgb(var(--ui-fg) / 0.3)",
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export function AtcSpectrum({
  audioElement,
  active,
  feedName,
  feedFrequency,
}: {
  audioElement: HTMLAudioElement | null;
  active: boolean;
  feedName?: string;
  feedFrequency?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const barsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));
  const [mode, setMode] = useState<VisualizationMode>("combined");

  // ── Connect to Web Audio API ────────────────────────────────────────
  useEffect(() => {
    if (!active || !audioElement) {
      barsRef.current = new Array(BAR_COUNT).fill(0);
      analyserRef.current = null;
      return;
    }

    analyserRef.current = getOrCreateConnection(audioElement);
  }, [active, audioElement]);

  // ── Resize observer for responsive canvas ───────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Main render loop ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let freqData: Uint8Array<ArrayBuffer> | null = null;
    let timeData: Uint8Array<ArrayBuffer> | null = null;
    let binRanges: [number, number][] | null = null;
    let lastBinCount = 0;

    function draw() {
      rafRef.current = requestAnimationFrame(draw);

      const dpr = window.devicePixelRatio || 1;
      const W = canvas!.width / dpr;
      const H = canvas!.height / dpr;

      if (W === 0 || H === 0) return;

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);

      const analyser = analyserRef.current;
      const binCount = analyser?.frequencyBinCount ?? 128;

      // Re-allocate if bin count changed
      if (binCount !== lastBinCount) {
        freqData = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
        timeData = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
        binRanges = buildBinRanges(binCount, BAR_COUNT);
        lastBinCount = binCount;
      }

      if (analyser && freqData && timeData) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
      }

      const now = performance.now();
      const drawW = W - CANVAS_PADDING * 2;
      const baseY = H - CANVAS_PADDING;
      const maxBarH = H - CANVAS_PADDING * 2;
      const currentMode = mode;

      // ── Pre-compute bar values ────────────────────────────────────
      let hasSignal = false;
      let peakVal = 0;

      for (let i = 0; i < BAR_COUNT; i++) {
        const [startBin, endBin] = binRanges![i];
        let sum = 0;
        const count = endBin - startBin;
        for (let b = startBin; b < endBin; b++) {
          sum += freqData ? freqData[b] : 0;
        }
        const raw = analyser && count > 0 ? sum / count / 255 : 0;

        // Breathing: barely perceptible, organic phase per bar
        const breathPeriod = 2600 + (i % 5) * 280;
        const breathPhase =
          ((now / breathPeriod) + i * 0.15) % (Math.PI * 2);
        const breathVal = 0.02 + Math.sin(breathPhase) * 0.008;
        const target = raw > 0.02 ? raw : breathVal;

        const lerp = target > barsRef.current[i] ? LERP_UP : LERP_DOWN;
        barsRef.current[i] += (target - barsRef.current[i]) * lerp;

        if (raw > 0.02) hasSignal = true;
        if (barsRef.current[i] > peakVal) peakVal = barsRef.current[i];
      }

      // ── Ambient glow from bottom ─────────────────────────────────
      if (hasSignal && peakVal > 0.12) {
        const glowAlpha = Math.min(peakVal * 0.05, 0.035);
        const glow = ctx!.createRadialGradient(
          W / 2, H + 20, 0,
          W / 2, H + 20, W * 0.55,
        );
        glow.addColorStop(0, accent(0.5, glowAlpha));
        glow.addColorStop(1, "transparent");
        ctx!.fillStyle = glow;
        ctx!.fillRect(0, 0, W, H);
      }

      // ── Spectrum bars ─────────────────────────────────────────────
      if (currentMode === "spectrum" || currentMode === "combined") {
        const totalBarW = drawW / BAR_COUNT;
        const barW = Math.max(2, totalBarW * 0.55);
        const radius = Math.min(barW * 0.45, 3.5);

        for (let i = 0; i < BAR_COUNT; i++) {
          const val = barsRef.current[i];
          const isActive = val > 0.03;

          const barH = Math.max(2, val * maxBarH * 0.88);
          const x =
            CANVAS_PADDING + i * totalBarW + (totalBarW - barW) / 2;
          const y = baseY - barH;
          const alpha = isActive ? 0.45 + val * 0.55 : 0.04;

          // Gradient fill for active bars, flat tint for idle
          if (isActive && barH > 5) {
            const grad = ctx!.createLinearGradient(0, y, 0, y + barH);
            grad.addColorStop(0, accent(val, alpha));
            grad.addColorStop(0.7, accent(val * 0.65, alpha * 0.8));
            grad.addColorStop(1, accent(val * 0.2, alpha * 0.4));
            ctx!.fillStyle = grad;
          } else {
            ctx!.fillStyle = isActive
              ? accent(val, alpha)
              : `rgba(255, 255, 255, ${alpha})`;
          }

          ctx!.beginPath();
          ctx!.roundRect(x, y, barW, barH, radius);
          ctx!.fill();

          // Soft top glow on loud bars
          if (val > 0.45 && isActive) {
            ctx!.save();
            ctx!.shadowColor = accent(val, 0.35);
            ctx!.shadowBlur = 6 + val * 8;
            ctx!.fillStyle = accent(val, 0.05);
            ctx!.beginPath();
            ctx!.roundRect(x, y, barW, Math.min(barH, 8), radius);
            ctx!.fill();
            ctx!.restore();
          }
        }
      }

      // ── Waveform / Oscilloscope ───────────────────────────────────
      if (
        (currentMode === "waveform" || currentMode === "combined") &&
        timeData
      ) {
        const waveH = currentMode === "waveform" ? H * 0.5 : H * 0.14;
        const waveMid = currentMode === "waveform" ? H * 0.5 : H * 0.5;
        const waveAlpha = currentMode === "combined" ? 0.12 : 0.45;

        const step = Math.max(1, Math.floor(timeData.length / 128));
        const pts: { x: number; y: number }[] = [];
        let waveSignal = false;

        for (let i = 0; i < timeData.length; i += step) {
          const v = (timeData[i] - 128) / 128;
          if (Math.abs(v) > 0.02) waveSignal = true;
          pts.push({
            x: CANVAS_PADDING + (i / (timeData.length - 1)) * drawW,
            y: waveMid + v * waveH,
          });
        }

        // Catmull-Rom spline renderer
        function spline(lw: number, style: string) {
          if (pts.length < 2) return;
          ctx!.beginPath();
          ctx!.strokeStyle = style;
          ctx!.lineWidth = lw;
          ctx!.lineJoin = "round";
          ctx!.lineCap = "round";
          ctx!.moveTo(pts[0].x, pts[0].y);

          for (let j = 0; j < pts.length - 1; j++) {
            const p0 = pts[Math.max(0, j - 1)];
            const p1 = pts[j];
            const p2 = pts[Math.min(pts.length - 1, j + 1)];
            const p3 = pts[Math.min(pts.length - 1, j + 2)];

            ctx!.bezierCurveTo(
              p1.x + (p2.x - p0.x) / 6,
              p1.y + (p2.y - p0.y) / 6,
              p2.x - (p3.x - p1.x) / 6,
              p2.y - (p3.y - p1.y) / 6,
              p2.x,
              p2.y,
            );
          }
          ctx!.stroke();
        }

        // Outer glow
        if (waveSignal) {
          ctx!.save();
          ctx!.shadowColor = accent(0.5, waveAlpha * 0.15);
          ctx!.shadowBlur = 12;
          spline(3, accent(0.5, waveAlpha * 0.06));
          ctx!.restore();
        }

        // Main trace
        spline(1.5, accent(0.6, waveAlpha));
      }
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="overflow-hidden rounded-[20px] backdrop-blur-3xl"
      style={{
        border: "0.5px solid rgb(var(--ui-fg) / 0.08)",
        backgroundColor: "rgb(var(--ui-bg) / 0.55)",
        boxShadow:
          "0 8px 32px rgb(0 0 0 / 0.3), inset 0 0.5px 0 rgb(var(--ui-fg) / 0.04)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5"
        style={{ borderBottom: "0.5px solid rgb(var(--ui-fg) / 0.06)" }}
      >
        {/* Feed info */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Live indicator */}
          <div className="relative flex h-1.5 w-1.5 shrink-0">
            {active && (
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-30"
                style={{ backgroundColor: "rgb(52, 211, 153)" }}
              />
            )}
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: active
                  ? "rgb(52, 211, 153)"
                  : "rgb(var(--ui-fg) / 0.15)",
              }}
            />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="truncate text-[11px] font-medium"
              style={{
                color: "rgb(var(--ui-fg) / 0.55)",
                letterSpacing: "-0.01em",
              }}
            >
              {feedName ?? "ATC Audio"}
            </span>
            {feedFrequency && (
              <span
                className="font-mono text-[9px] tabular-nums shrink-0"
                style={{ color: "rgb(var(--ui-fg) / 0.22)" }}
              >
                {feedFrequency}
              </span>
            )}
          </div>
        </div>

        {/* Mode selector */}
        <SegmentedControl mode={mode} onChange={setMode} />
      </div>

      {/* Visualization canvas */}
      <div className="relative h-40 w-full sm:h-48">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        />
      </div>
    </motion.div>
  );
}

"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import {
  X,
  Eye,
  ArrowUp,
  ArrowDown,
  Minus,
  Gauge,
  ChevronDown,
  Video,
  VideoOff,
} from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import { formatCallsign, headingToCardinal } from "@/lib/flight-utils";
import { lookupAirline } from "@/lib/airlines";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import { Slider } from "@/components/ui/slider";
import { useSettings } from "@/hooks/use-settings";

type FpvHudProps = {
  flight: FlightState;
  onExit: () => void;
};

const COMPASS_LABELS: Record<number, string> = {
  0: "N",
  45: "NE",
  90: "E",
  135: "SE",
  180: "S",
  225: "SW",
  270: "W",
  315: "NW",
};

const FPV_PITCH_MIN = 20;
const FPV_PITCH_MAX = 45;

function CompassRibbon({ heading }: { heading: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;
    const w = 200;
    const h = 32;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const hdg = heading ?? 0;
    const cx = w / 2;
    const pxPerDeg = 2.2;
    for (let deg = -360; deg <= 720; deg += 5) {
      const normDeg = ((deg % 360) + 360) % 360;
      const offset = (((deg - hdg + 540) % 360) - 180) * pxPerDeg;
      const x = cx + offset;

      if (x < -10 || x > w + 10) continue;

      const isMajor = normDeg % 45 === 0;
      const isMinor = normDeg % 15 === 0;
      const isTiny = normDeg % 5 === 0;

      if (isMajor) {
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, h - 1);
        ctx.lineTo(x, h - 10);
        ctx.stroke();

        const label = COMPASS_LABELS[normDeg] ?? `${normDeg}`;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "bold 9px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, x, h - 14);
      } else if (isMinor) {
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, h - 1);
        ctx.lineTo(x, h - 7);
        ctx.stroke();
      } else if (isTiny) {
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, h - 1);
        ctx.lineTo(x, h - 4);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(56, 189, 248, 0.8)";
    ctx.beginPath();
    ctx.moveTo(cx - 4, 0);
    ctx.lineTo(cx + 4, 0);
    ctx.lineTo(cx, 6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 6);
    ctx.lineTo(cx, h);
    ctx.stroke();
  }, [heading]);

  return (
    <canvas
      ref={canvasRef}
      className="block"
      style={{ width: 200, height: 32 }}
      aria-label={
        heading !== null ? `Heading ${Math.round(heading)}°` : "No heading data"
      }
    />
  );
}

export function FpvHud({ flight, onExit }: FpvHudProps) {
  const { settings, update } = useSettings();
  const [controlsOpen, setControlsOpen] = useState(false);
  const altFeet =
    flight.baroAltitude !== null
      ? Math.round(flight.baroAltitude * 3.28084)
      : null;
  const speedKts =
    flight.velocity !== null ? Math.round(flight.velocity * 1.944) : null;
  const heading = flight.trueTrack ?? null;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const vs = flight.verticalRate;
  const vsFpm = vs !== null ? Math.round(vs * 196.85) : null;
  const vsDisplay = vsFpm !== null ? `${vsFpm > 0 ? "+" : ""}${vsFpm}` : null;
  const airline = useMemo(
    () => lookupAirline(flight.callsign),
    [flight.callsign],
  );
  const logoUrl = useMemo(() => {
    return airlineLogoCandidates(airline)[0] ?? null;
  }, [airline]);
  const vsIcon =
    vs !== null ? (
      vs > 0.5 ? (
        <ArrowUp className="h-3 w-3" />
      ) : vs < -0.5 ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )
    ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="pointer-events-auto fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
    >
      <div
        className="flex flex-col items-center gap-0 overflow-hidden rounded-2xl border border-white/8 bg-black/70 shadow-[0_16px_64px_rgba(0,0,0,0.6)] backdrop-blur-3xl"
        role="status"
        aria-live="polite"
        aria-label="First person view flight instruments"
      >
        <div className="w-full border-b border-white/6 px-3 pt-2 pb-1">
          <div
            className="mx-auto w-fit overflow-hidden rounded-lg"
            style={{ width: 200 }}
          >
            <CompassRibbon heading={heading} />
          </div>
          <p className="mt-0.5 text-center text-[11px] font-bold tabular-nums text-sky-400/70">
            {heading !== null ? `${Math.round(heading)}° ${cardinal}` : "—"}
          </p>
        </div>

        <div className="flex items-stretch">
          <div className="flex items-center gap-2 border-r border-white/6 px-4 py-2.5">
            {logoUrl ? (
              <span className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-white/90 ring-1 ring-white/20">
                <Image
                  src={logoUrl}
                  alt={airline ? `${airline} logo` : "Airline logo"}
                  fill
                  sizes="24px"
                  className="object-contain p-1"
                  unoptimized
                />
              </span>
            ) : (
              <Eye className="h-3.5 w-3.5 text-emerald-400/70 animate-pulse" />
            )}
            <div>
              <p className="text-[13px] font-bold tracking-wide text-white/90">
                {formatCallsign(flight.callsign)}
              </p>
              <p className="text-[9px] font-medium uppercase tracking-widest text-white/25">
                {airline ?? flight.originCountry}
              </p>
            </div>
          </div>

          <div className="flex min-w-20 flex-col items-center justify-center border-r border-white/6 px-4 py-2">
            <div className="flex items-center gap-1 text-white/30">
              <ArrowUp className="h-2.5 w-2.5" />
              <span className="text-[9px] font-semibold uppercase tracking-wider">
                ALT
              </span>
            </div>
            <p className="text-[15px] font-bold tabular-nums text-white/90">
              {altFeet !== null ? altFeet.toLocaleString() : "—"}
            </p>
            <p className="text-[9px] font-medium text-white/25">ft</p>
          </div>

          <div className="flex min-w-17.5 flex-col items-center justify-center border-r border-white/6 px-4 py-2">
            <div className="flex items-center gap-1 text-white/30">
              <Gauge className="h-2.5 w-2.5" />
              <span className="text-[9px] font-semibold uppercase tracking-wider">
                SPD
              </span>
            </div>
            <p className="text-[15px] font-bold tabular-nums text-white/90">
              {speedKts ?? "—"}
            </p>
            <p className="text-[9px] font-medium text-white/25">kts</p>
          </div>

          <div className="flex min-w-20 flex-col items-center justify-center border-r border-white/6 px-4 py-2">
            <div className="flex items-center gap-1 text-white/30">
              {vsIcon ?? <Minus className="h-2.5 w-2.5" />}
              <span className="text-[9px] font-semibold uppercase tracking-wider">
                V/S
              </span>
            </div>
            <p
              className={`text-[15px] font-bold tabular-nums ${
                vs !== null && vs > 0.5
                  ? "text-emerald-400/80"
                  : vs !== null && vs < -0.5
                    ? "text-amber-400/80"
                    : "text-white/90"
              }`}
            >
              {vsDisplay ?? "—"}
            </p>
            <p className="text-[9px] font-medium text-white/25">fpm</p>
          </div>

          <button
            onClick={onExit}
            className="flex items-center gap-1.5 px-4 py-2 text-white/40 hover:bg-white/5 hover:text-white/60 transition-colors"
            aria-label="Exit first person view"
            title="Exit FPV (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="w-full border-t border-white/6">
          <button
            type="button"
            onClick={() => setControlsOpen((prev) => !prev)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-white/3"
            aria-expanded={controlsOpen}
            aria-label="Toggle FPV camera controls"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Camera
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold tabular-nums text-white/50">
                {settings.fpvFreeCamera
                  ? "Free"
                  : `${Math.round(settings.fpvPitch)}°`}
              </span>
              <ChevronDown
                className={`h-3 w-3 text-white/35 transition-transform duration-200 ${
                  controlsOpen ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>

          {controlsOpen && (
            <div className="px-3 pt-0.5 pb-2.5 space-y-2.5">
              <button
                type="button"
                onClick={() => update("fpvFreeCamera", !settings.fpvFreeCamera)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  settings.fpvFreeCamera
                    ? "bg-sky-500/15 text-sky-400/90"
                    : "bg-white/3 text-white/40 hover:bg-white/5"
                }`}
                aria-label="Toggle free camera mode"
                title={
                  settings.fpvFreeCamera
                    ? "Switch to chase camera"
                    : "Switch to free camera"
                }
              >
                {settings.fpvFreeCamera ? (
                  <VideoOff className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Video className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="text-[10px] font-semibold uppercase tracking-wider">
                  {settings.fpvFreeCamera ? "Free Camera" : "Chase Camera"}
                </span>
              </button>

              {!settings.fpvFreeCamera && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-medium text-white/35">
                      View
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums text-white/65">
                      {Math.round(settings.fpvPitch)}
                      <span className="text-[9px] font-normal text-white/30">
                        °
                      </span>
                    </span>
                  </div>
                  <Slider
                    min={FPV_PITCH_MIN}
                    max={FPV_PITCH_MAX}
                    step={1}
                    value={[settings.fpvPitch]}
                    onValueChange={(vals) => update("fpvPitch", vals[0])}
                    aria-label="FPV view angle"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

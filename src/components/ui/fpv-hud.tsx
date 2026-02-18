"use client";

import { useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { X, Eye, ArrowUp, ArrowDown, Minus, Gauge } from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import { formatCallsign, headingToCardinal } from "@/lib/flight-utils";
import { lookupAirline } from "@/lib/airlines";
import { airlineLogoCandidates } from "@/lib/airline-logos";

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
      className="pointer-events-auto fixed right-2 bottom-3 left-2 z-50 sm:right-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2"
    >
      <div
        className="mx-auto flex w-full max-w-176 flex-col items-center gap-0 overflow-hidden rounded-2xl border border-white/8 bg-black/70 shadow-[0_16px_64px_rgba(0,0,0,0.6)] backdrop-blur-3xl"
        role="status"
        aria-live="polite"
        aria-label="First person view flight instruments"
      >
        <div className="w-full border-b border-white/6 px-2.5 pt-2 pb-1 sm:px-3">
          <div
            className="mx-auto w-fit scale-95 overflow-hidden rounded-lg sm:scale-100"
            style={{ width: 200 }}
          >
            <CompassRibbon heading={heading} />
          </div>
          <p className="mt-0.5 text-center text-[11px] font-bold tabular-nums text-sky-400/70">
            {heading !== null ? `${Math.round(heading)}° ${cardinal}` : "—"}
          </p>
        </div>

        <div className="flex w-full items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 border-r border-white/6 px-2 py-2 sm:gap-2 sm:px-4 sm:py-2.5">
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
            <div className="min-w-0">
              <p className="truncate text-[12px] font-bold tracking-wide text-white/90 sm:text-[13px]">
                {formatCallsign(flight.callsign)}
              </p>
              <p className="truncate text-[9px] font-medium uppercase tracking-widest text-white/25">
                {airline ?? flight.originCountry}
              </p>
            </div>
          </div>

          <div className="flex min-w-15 flex-col items-center justify-center border-r border-white/6 px-2 py-2 sm:min-w-20 sm:px-4">
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

          <div className="flex min-w-14 flex-col items-center justify-center border-r border-white/6 px-2 py-2 sm:min-w-17.5 sm:px-4">
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

          <div className="flex min-w-15 flex-col items-center justify-center border-r border-white/6 px-2 py-2 sm:min-w-20 sm:px-4">
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
            className="flex items-center gap-1.5 px-2.5 py-2 text-white/40 transition-colors hover:bg-white/5 hover:text-white/60 sm:px-4"
            aria-label="Exit first person view"
            title="Exit FPV (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

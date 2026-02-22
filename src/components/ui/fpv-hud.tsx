"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { X, ArrowUp, ArrowDown, Minus, Gauge } from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import { formatCallsign, headingToCardinal } from "@/lib/flight-utils";
import { lookupAirline } from "@/lib/airlines";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import {
  loadedAirlineLogoUrls,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/lib/logo-cache";

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
    const w = 260;
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
      style={{ width: 260, height: 32 }}
      aria-label={
        heading !== null ? `Heading ${Math.round(heading)}°` : "No heading data"
      }
    />
  );
}

export function FpvHud({ flight, onExit }: FpvHudProps) {
  const altFeet =
    flight.baroAltitude !== null && Number.isFinite(flight.baroAltitude)
      ? Math.round(flight.baroAltitude * 3.28084)
      : null;
  const speedKts =
    flight.velocity !== null && Number.isFinite(flight.velocity)
      ? Math.round(flight.velocity * 1.944)
      : null;
  const heading =
    flight.trueTrack !== null && Number.isFinite(flight.trueTrack)
      ? flight.trueTrack
      : null;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const vs = flight.verticalRate;
  const vsFpm =
    vs !== null && Number.isFinite(vs) ? Math.round(vs * 196.85) : null;
  const vsDisplay = vsFpm !== null ? `${vsFpm > 0 ? "+" : ""}${vsFpm}` : null;
  const airline = useMemo(
    () => lookupAirline(flight.callsign),
    [flight.callsign],
  );
  const logoCandidates = useMemo(
    () => airlineLogoCandidates(airline),
    [airline],
  );
  const airlineKey = airline ?? "__none__";
  const [logoIndexByAirline, setLogoIndexByAirline] = useState<
    Record<string, number>
  >({});
  const [logoLoadedByKey, setLogoLoadedByKey] = useState<
    Record<string, boolean>
  >({});
  const [genericFailedByAirline, setGenericFailedByAirline] = useState<
    Record<string, boolean>
  >({});
  const baseLogoIndex = logoIndexByAirline[airlineKey] ?? 0;
  const resolvedLogoIndex = useMemo(() => {
    let idx = baseLogoIndex;
    while (
      idx < logoCandidates.length &&
      wasAirlineLogoRecentlyFailed(logoCandidates[idx] ?? "")
    ) {
      idx += 1;
    }
    return idx;
  }, [baseLogoIndex, logoCandidates]);
  const logoUrl = logoCandidates[resolvedLogoIndex] ?? null;
  const logoLoadKey = `${airlineKey}:${resolvedLogoIndex}`;
  const logoLoaded =
    logoUrl !== null &&
    (loadedAirlineLogoUrls.has(logoUrl) ||
      (logoLoadedByKey[logoLoadKey] ?? false));
  const genericLogoFailed = genericFailedByAirline[airlineKey] ?? false;
  const genericLogoUrl = "/airline-logos/envoy-air.png";
  const vsIcon =
    vs !== null && Number.isFinite(vs) ? (
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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="pointer-events-auto fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]"
    >
      <div
        className="flex w-[min(92vw,460px)] flex-col items-center gap-0 overflow-hidden rounded-xl border border-white/8 bg-black/70 pb-1 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-3xl md:w-max"
        role="status"
        aria-live="polite"
        aria-label="First person view flight instruments"
      >
        <div className="w-full border-b border-white/6 px-2 pt-1.5 pb-0.5 sm:px-2.5">
          <div
            className="mx-auto w-fit overflow-hidden rounded-md"
            style={{ width: 260 }}
          >
            <CompassRibbon heading={heading} />
          </div>
          <p className="mt-0 text-center text-[10px] font-bold tabular-nums text-sky-400/70">
            {heading !== null ? `${Math.round(heading)}° ${cardinal}` : "—"}
          </p>
        </div>

        <div className="flex w-full items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 border-r border-white/6 px-2 py-1.5 sm:px-3 sm:py-2">
            {logoUrl ? (
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/95 shadow-sm ring-1 ring-white/20">
                {!logoLoaded && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 animate-pulse bg-linear-to-br from-white/85 via-neutral-200/65 to-white/80"
                  />
                )}
                <Image
                  src={logoUrl}
                  alt={airline ? `${airline} logo` : "Airline logo"}
                  fill
                  sizes="32px"
                  className="relative object-contain p-1"
                  unoptimized
                  onLoad={() => {
                    if (logoUrl) loadedAirlineLogoUrls.add(logoUrl);
                    setLogoLoadedByKey((current) => ({
                      ...current,
                      [logoLoadKey]: true,
                    }));
                  }}
                  onError={() => {
                    if (logoUrl) markAirlineLogoFailed(logoUrl);
                    if (resolvedLogoIndex + 1 < logoCandidates.length) {
                      setLogoIndexByAirline((current) => ({
                        ...current,
                        [airlineKey]: resolvedLogoIndex + 1,
                      }));
                      return;
                    }
                    setLogoIndexByAirline((current) => ({
                      ...current,
                      [airlineKey]: logoCandidates.length,
                    }));
                  }}
                />
              </span>
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
                <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white/95 ring-1 ring-white/15">
                  {genericLogoFailed ? (
                    <span className="text-[12px] font-semibold text-black/25">
                      —
                    </span>
                  ) : (
                    <Image
                      src={genericLogoUrl}
                      alt="Generic airline logo"
                      fill
                      sizes="28px"
                      className="object-contain p-1 grayscale opacity-80"
                      unoptimized
                      onError={() =>
                        setGenericFailedByAirline((current) => ({
                          ...current,
                          [airlineKey]: true,
                        }))
                      }
                    />
                  )}
                </span>
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[12px] font-bold tracking-wide text-white/90 sm:text-[13px]">
                {formatCallsign(flight.callsign)}
              </p>
              <p className="truncate text-[9px] font-medium uppercase tracking-widest text-white/30">
                {airline ?? flight.originCountry}
              </p>
            </div>
          </div>

          <div className="flex min-w-12 flex-col items-center justify-center border-r border-white/6 px-2.5 py-1.5 sm:min-w-16 sm:px-2.5">
            <div className="flex items-center gap-0.5 text-white/30">
              <ArrowUp className="h-2 w-2" />
              <span className="text-[8px] font-semibold uppercase tracking-wider">
                ALT
              </span>
            </div>
            <p className="text-[13px] font-bold tabular-nums text-white/90">
              {altFeet !== null ? altFeet.toLocaleString() : "—"}
            </p>
            <p className="text-[8px] font-medium text-white/25">ft</p>
          </div>

          <div className="flex min-w-11 flex-col items-center justify-center border-r border-white/6 px-2.5 py-1.5 sm:min-w-14 sm:px-2.5">
            <div className="flex items-center gap-0.5 text-white/30">
              <Gauge className="h-2 w-2" />
              <span className="text-[8px] font-semibold uppercase tracking-wider">
                SPD
              </span>
            </div>
            <p className="text-[13px] font-bold tabular-nums text-white/90">
              {speedKts ?? "—"}
            </p>
            <p className="text-[8px] font-medium text-white/25">kts</p>
          </div>

          <div className="flex min-w-12 flex-col items-center justify-center border-r border-white/6 px-2.5 py-1.5 sm:min-w-16 sm:px-2.5">
            <div className="flex items-center gap-0.5 text-white/30">
              {vsIcon ?? <Minus className="h-2 w-2" />}
              <span className="text-[8px] font-semibold uppercase tracking-wider">
                V/S
              </span>
            </div>
            <p
              className={`text-[13px] font-bold tabular-nums ${
                vs !== null && vs > 0.5
                  ? "text-emerald-400/80"
                  : vs !== null && vs < -0.5
                    ? "text-amber-400/80"
                    : "text-white/90"
              }`}
            >
              {vsDisplay ?? "—"}
            </p>
            <p className="text-[8px] font-medium text-white/25">fpm</p>
          </div>

          <button
            onClick={onExit}
            className="flex items-center gap-1 px-2.5 py-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/60 sm:px-2.5"
            aria-label="Exit first person view"
            title="Exit FPV (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

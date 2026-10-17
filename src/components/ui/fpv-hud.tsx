"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import {
  X,
  ArrowUp,
  ArrowDown,
  Minus,
  Gauge,
  Wind,
  Thermometer,
  Shield,
  AlertTriangle,
  Target,
  Navigation,
} from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import { cleanText, formatAircraftIdentity } from "@/lib/aircraft-sidebar";
import { headingToCardinal } from "@/lib/flight-utils";
import { lookupAirline } from "@/lib/airlines";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import {
  trackAirlineLogoLoaded,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/lib/logo-cache";
import { useSettings } from "@/hooks/use-settings";
import {
  altitudeValueFromFeet,
  altitudeValueFromMeters,
  altitudeUnitLabel,
  formatPressureHpa,
  formatTemperatureC,
  formatVerticalSpeedValue,
  speedValueFromKnots,
  speedValueFromMs,
  speedUnitLabel,
  verticalSpeedUnitLabel,
} from "@/lib/unit-formatters";

type FpvHudProps = {
  /** Null while a poll misses the aircraft; the HUD keeps its last reading. */
  flight: FlightState | null;
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

    const isDark = document.documentElement.classList.contains("dark");
    const fg = isDark ? "255,255,255" : "0,0,0";
    const styles = getComputedStyle(document.documentElement);
    const tint = styles.getPropertyValue("--tint").trim();
    const font = getComputedStyle(document.body).fontFamily;

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
        ctx.strokeStyle = `rgba(${fg},0.45)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, h - 1);
        ctx.lineTo(x, h - 10);
        ctx.stroke();

        const label = COMPASS_LABELS[normDeg] ?? `${normDeg}`;
        ctx.fillStyle = `rgba(${fg},0.55)`;
        ctx.font = `540 10px ${font}`;
        ctx.textAlign = "center";
        ctx.fillText(label, x, h - 14);
      } else if (isMinor) {
        ctx.strokeStyle = `rgba(${fg},0.22)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, h - 1);
        ctx.lineTo(x, h - 7);
        ctx.stroke();
      } else if (isTiny) {
        ctx.strokeStyle = `rgba(${fg},0.10)`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, h - 1);
        ctx.lineTo(x, h - 4);
        ctx.stroke();
      }
    }

    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.moveTo(cx - 4, 0);
    ctx.lineTo(cx + 4, 0);
    ctx.lineTo(cx, 6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = tint;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 6);
    ctx.lineTo(cx, h);
    ctx.stroke();
    ctx.globalAlpha = 1;
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

export function FpvHud({ flight: liveFlight, onExit }: FpvHudProps) {
  const [lastFlight, setLastFlight] = useState(liveFlight);
  if (liveFlight && liveFlight !== lastFlight) setLastFlight(liveFlight);
  const flight = liveFlight ?? lastFlight;
  if (!flight) return null;
  return <FpvInstruments flight={flight} onExit={onExit} />;
}

function FpvInstruments({
  flight,
  onExit,
}: {
  flight: FlightState;
  onExit: () => void;
}) {
  const { settings } = useSettings();
  const altDisplay = altitudeValueFromMeters(
    flight.baroAltitude,
    settings.unitSystem,
  );
  const speedDisplay = speedValueFromMs(flight.velocity, settings.unitSystem);
  const heading =
    flight.trueTrack !== null && Number.isFinite(flight.trueTrack)
      ? flight.trueTrack
      : null;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const vs =
    flight.verticalRate != null && Number.isFinite(flight.verticalRate)
      ? flight.verticalRate
      : flight.geomRate != null && Number.isFinite(flight.geomRate)
        ? flight.geomRate
        : null;
  const vsDisplay = formatVerticalSpeedValue(vs, settings.unitSystem);

  // ── Avionics data (readsb only) ────────────────────────────────────
  const iasDisplay = speedValueFromKnots(flight.ias, settings.unitSystem);
  const machNum = flight.mach ?? null;
  const windDir = flight.windDirection ?? null;
  const windSpd = speedValueFromKnots(flight.windSpeed, settings.unitSystem);
  const oatC = flight.oat ?? null;
  const qnhValue = flight.navQnh ?? null;
  const selAlt = altitudeValueFromFeet(
    flight.navAltitudeMcp,
    settings.unitSystem,
  );
  const fmsAlt = altitudeValueFromFeet(
    flight.navAltitudeFms,
    settings.unitSystem,
  );
  const selHdg =
    flight.navHeading != null && Number.isFinite(flight.navHeading)
      ? Math.round(flight.navHeading)
      : null;
  const navModes = flight.navModes ?? null;
  const rollDeg = flight.roll ?? null;
  const trackRateVal = flight.trackRate ?? null;
  const isMilitary = (flight.dbFlags ?? 0) & 1;
  const emergencyStatus = flight.emergencyStatus ?? null;

  const hasAvionicsRow =
    iasDisplay !== null ||
    machNum !== null ||
    (windDir !== null && windSpd !== null) ||
    oatC !== null ||
    qnhValue !== null ||
    (rollDeg !== null && Math.abs(rollDeg) > 1) ||
    (trackRateVal !== null && Math.abs(trackRateVal) >= 0.1);
  const hasAutopilotRow =
    (navModes !== null && navModes.length > 0) ||
    selAlt !== null ||
    (fmsAlt !== null && fmsAlt !== selAlt) ||
    selHdg !== null;

  const airline = useMemo(
    () => lookupAirline(flight.callsign),
    [flight.callsign],
  );
  const logoCandidates = useMemo(
    () => airlineLogoCandidates(airline, flight.callsign),
    [airline, flight.callsign],
  );
  const airlineKey = airline ?? "__none__";
  const [logoIndexByAirline, setLogoIndexByAirline] = useState<
    Record<string, number>
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
        className="flex w-[min(92vw,460px)] flex-col items-center gap-0 overflow-hidden rounded-lg border border-border bg-background pb-1 shadow-lift md:w-max"
        role="status"
        aria-live="polite"
        aria-label="First person view flight instruments"
      >
        <div className="w-full border-b border-border px-2 pt-1.5 pb-0.5 sm:px-2.5">
          <div
            className="mx-auto w-fit overflow-hidden rounded-sm"
            style={{ width: 260 }}
          >
            <CompassRibbon heading={heading} />
          </div>
          <p className="mt-0 text-center font-mono text-micro text-tint">
            {heading !== null ? `${Math.round(heading)}° ${cardinal}` : "-"}
          </p>
        </div>

        <div className="flex w-full items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 border-r border-border px-2 py-1.5 sm:px-3 sm:py-2">
            {logoUrl ? (
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border">
                <Image
                  src={logoUrl}
                  alt={airline ? `${airline} logo` : "Airline logo"}
                  fill
                  sizes="32px"
                  className="relative object-contain p-1"
                  unoptimized
                  onLoad={() => trackAirlineLogoLoaded(logoUrl)}
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
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-border">
                <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border">
                  {genericLogoFailed ? (
                    <span className="text-label text-background">
                      -
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
              <div className="flex items-center gap-1">
                <p className="truncate text-label text-foreground sm:text-small">
                  {formatAircraftIdentity(flight, {
                    registration: cleanText(flight.registration),
                  })}
                </p>
                {isMilitary ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-micro text-warning">
                    <Shield className="h-2 w-2" />
                    MIL
                  </span>
                ) : null}
                {emergencyStatus ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-micro text-danger">
                    <AlertTriangle className="h-2 w-2" />
                    {emergencyStatus}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-micro text-subtle">
                {airline ?? flight.registrationCountry}
              </p>
            </div>
          </div>

          <div className="flex min-w-12 flex-col items-center justify-center border-r border-border px-2.5 py-1.5 sm:min-w-16 sm:px-2.5">
            <div className="flex items-center gap-0.5 text-subtle">
              <ArrowUp className="h-2 w-2" />
              <span className="text-micro">
                ALT
              </span>
            </div>
            <p className="text-small font-medium text-foreground">
               {altDisplay !== null ? altDisplay.toLocaleString() : "-"}
             </p>
            <p className="text-micro text-subtle">{altitudeUnitLabel(settings.unitSystem)}</p>
          </div>

          <div className="flex min-w-11 flex-col items-center justify-center border-r border-border px-2.5 py-1.5 sm:min-w-14 sm:px-2.5">
            <div className="flex items-center gap-0.5 text-subtle">
              <Gauge className="h-2 w-2" />
              <span className="text-micro">
                SPD
              </span>
            </div>
            <p className="text-small font-medium text-foreground">
               {speedDisplay ?? "-"}
             </p>
            <p className="text-micro text-subtle">{speedUnitLabel(settings.unitSystem)}</p>
          </div>

          <div className="flex min-w-12 flex-col items-center justify-center border-r border-border px-2.5 py-1.5 sm:min-w-16 sm:px-2.5">
            <div className="flex items-center gap-0.5 text-subtle">
              {vsIcon ?? <Minus className="h-2 w-2" />}
              <span className="text-micro">
                V/S
              </span>
            </div>
            <p
              className="text-small font-medium text-foreground"
            >
               {vsDisplay.text ?? "-"}
             </p>
            <p className="text-micro text-subtle">{verticalSpeedUnitLabel(settings.unitSystem)}</p>
          </div>

          <button
            onClick={onExit}
            className="flex items-center gap-1 px-2.5 py-1.5 text-subtle transition-colors hover:bg-card hover:text-muted-foreground sm:px-2.5"
            aria-label="Exit first person view"
            title="Exit FPV (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── Avionics strip (IAS, Mach, Wind, OAT) ──────────────── */}
        {hasAvionicsRow && (
          <div className="flex w-full items-center justify-center gap-3 border-t border-border px-3 py-1 sm:gap-4">
            {iasDisplay !== null && (
              <span className="flex items-center gap-1 text-micro text-muted-foreground">
                <span className="text-micro text-subtle">
                  IAS
                </span>
                <span className="font-medium text-muted-foreground">
                  {iasDisplay}
                </span>
                <span className="text-micro text-subtle">{speedUnitLabel(settings.unitSystem)}</span>
              </span>
            )}
            {machNum !== null && (
              <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
                <span className="text-micro text-subtle">
                  M
                </span>
                <span className="font-medium text-muted-foreground">
                  {machNum.toFixed(2)}
                </span>
              </span>
            )}
            {windDir !== null && windSpd !== null && (
              <span className="flex items-center gap-1 text-micro text-muted-foreground">
                <Wind className="h-2.5 w-2.5 text-subtle" />
                <span className="font-medium text-muted-foreground">
                  {Math.round(windDir)}°
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="font-medium text-muted-foreground">
                  {Math.round(windSpd)}
                </span>
                <span className="text-micro text-subtle">{speedUnitLabel(settings.unitSystem)}</span>
              </span>
            )}
            {oatC !== null && (
              <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
                <Thermometer className="h-2.5 w-2.5 text-subtle" />
                <span className="font-medium text-muted-foreground">
                  {formatTemperatureC(oatC, settings.unitSystem)}
                </span>
              </span>
            )}
            {(rollDeg !== null && Math.abs(rollDeg) > 1) ||
            (trackRateVal !== null && Math.abs(trackRateVal) >= 0.1) ? (
              <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
                <span className="text-micro text-subtle">
                  BANK
                </span>
                <span className="font-medium text-muted-foreground">
                  {rollDeg !== null && Math.abs(rollDeg) > 1
                    ? `${rollDeg > 0 ? "R" : "L"}${Math.round(Math.abs(rollDeg))}°`
                    : "-"}
                  {trackRateVal !== null &&
                    Math.abs(trackRateVal) >= 0.1 && (
                      <span className="ml-1 text-muted-foreground">
                        {trackRateVal > 0 ? "R" : "L"}
                        {Math.abs(trackRateVal).toFixed(1)}°/s
                      </span>
                    )}
                </span>
              </span>
            ) : null}
            {qnhValue !== null && (
              <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
                <span className="text-micro text-subtle">
                  QNH
                </span>
                <span className="font-medium text-muted-foreground">
                  {formatPressureHpa(qnhValue, settings.unitSystem)}
                </span>
              </span>
            )}
          </div>
        )}

        {/* ── Autopilot / selected altitude strip ────────────────── */}
        {hasAutopilotRow && (
          <div className="flex w-full items-center justify-center gap-2 border-t border-border px-3 py-1">
            {navModes !== null &&
              navModes.map((mode) => (
                <span
                  key={mode}
                  className={`font-mono text-micro ${
                    mode === "tcas" ? "text-warning" : "text-tint"
                  }`}
                >
                  {mode === "autopilot"
                    ? "AP"
                    : mode === "althold"
                      ? "ALT HLD"
                      : mode}
                </span>
              ))}
            {selAlt !== null && (
              <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
                <Target className="h-2.5 w-2.5 text-subtle" />
                <span className="text-micro text-subtle">
                  MCP
                </span>
                <span className="text-tint">
                  {selAlt.toLocaleString()}
                </span>
                <span className="text-micro text-subtle">{altitudeUnitLabel(settings.unitSystem)}</span>
              </span>
            )}
            {fmsAlt !== null && fmsAlt !== selAlt && (
              <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
                <Target className="h-2.5 w-2.5 text-subtle" />
                <span className="text-micro text-subtle">
                  FMS
                </span>
                <span className="text-tint">
                  {fmsAlt.toLocaleString()}
                </span>
                <span className="text-micro text-subtle">{altitudeUnitLabel(settings.unitSystem)}</span>
              </span>
            )}
            {selHdg !== null && (
              <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
                <Navigation className="h-2.5 w-2.5 text-subtle" />
                <span className="text-micro text-subtle">
                  HDG
                </span>
                <span className="text-tint">{selHdg}°</span>
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDown,
  Gauge,
  Wind,
  Thermometer,
  Navigation,
  Target,
  Plane,
  Compass,
  Radio,
  Activity,
  Zap,
} from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import type { UnitSystem } from "@/hooks/use-settings";
import {
  altitudeValueFromFeet,
  altitudeUnitLabel,
  formatPressureHpa,
  formatTemperatureC,
  speedValueFromKnots,
  speedUnitLabel,
} from "@/lib/unit-formatters";

type AvionicsSectionProps = {
  flight: FlightState;
  unitSystem: UnitSystem;
};

const NAV_MODE_LABELS: Record<string, string> = {
  autopilot: "AP",
  althold: "ALT HLD",
  vnav: "VNAV",
  lnav: "LNAV",
  approach: "APP",
  tcas: "TCAS",
};

const NAV_MODE_ICONS: Record<string, React.ReactNode> = {
  autopilot: <Plane className="h-2.5 w-2.5" />,
  althold: <Target className="h-2.5 w-2.5" />,
  vnav: <Navigation className="h-2.5 w-2.5" />,
  lnav: <Compass className="h-2.5 w-2.5" />,
  approach: <Radio className="h-2.5 w-2.5" />,
  tcas: <Activity className="h-2.5 w-2.5" />,
};

function navModeLabel(mode: string): string {
  return NAV_MODE_LABELS[mode.toLowerCase()] ?? mode.toUpperCase();
}

function navModeIcon(mode: string): React.ReactNode {
  return NAV_MODE_ICONS[mode.toLowerCase()] ?? <Zap className="h-2.5 w-2.5" />;
}

function navModeStyle(mode: string): string {
  const m = mode.toLowerCase();
  if (m === "tcas")
    return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  if (m === "autopilot")
    return "border-sky-500/25 bg-sky-500/10 text-sky-400/90";
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-400/90";
}

function DataCard({
  icon,
  label,
  value,
  unit,
  subvalue,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  subvalue?: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-[70px] flex-col justify-between rounded-[17px] border px-3 py-2.5 transition-colors ${
        highlight
          ? "border-cyan-400/18 bg-cyan-400/[0.07]"
          : "border-foreground/[0.055] bg-background/35 hover:bg-foreground/[0.04]"
      }`}
    >
      <div className="flex items-center gap-1.5 text-foreground/38">
        {icon}
        <span className="text-[9px] font-semibold uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p
        className={`mt-1 text-[14px] font-semibold tabular-nums ${
          highlight ? "text-cyan-300/90" : "text-foreground/88"
        }`}
      >
        {value}
        {unit ? (
          <span className="ml-0.5 text-[9px] font-medium text-foreground/38">
            {unit}
          </span>
        ) : null}
      </p>
      {subvalue ? (
        <p className="mt-0.5 text-[10px] text-foreground/38">{subvalue}</p>
      ) : null}
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${navModeStyle(mode)}`}
    >
      {navModeIcon(mode)}
      {navModeLabel(mode)}
    </span>
  );
}

export function AvionicsSection({
  flight,
  unitSystem,
}: AvionicsSectionProps) {
  const [open, setOpen] = useState(false);

  const iasValue = speedValueFromKnots(flight.ias, unitSystem);
  const machNum =
    typeof flight.mach === "number" && Number.isFinite(flight.mach)
      ? flight.mach
      : null;
  const windDir =
    typeof flight.windDirection === "number" &&
    Number.isFinite(flight.windDirection)
      ? flight.windDirection
      : null;
  const windSpd = speedValueFromKnots(flight.windSpeed, unitSystem);
  const oatC =
    typeof flight.oat === "number" && Number.isFinite(flight.oat)
      ? flight.oat
      : null;
  const rollDeg =
    typeof flight.roll === "number" && Number.isFinite(flight.roll)
      ? flight.roll
      : null;
  const trackRateVal =
    typeof flight.trackRate === "number" && Number.isFinite(flight.trackRate)
      ? flight.trackRate
      : null;
  const qnhValue =
    typeof flight.navQnh === "number" && Number.isFinite(flight.navQnh)
      ? flight.navQnh
      : null;

  const navModes =
    flight.navModes && flight.navModes.length > 0 ? flight.navModes : null;
  const mcpAlt = altitudeValueFromFeet(flight.navAltitudeMcp, unitSystem);
  const fmsAlt = altitudeValueFromFeet(flight.navAltitudeFms, unitSystem);
  const selHdg =
    typeof flight.navHeading === "number" &&
    Number.isFinite(flight.navHeading)
      ? Math.round(flight.navHeading)
      : null;

  const hasFlightData =
    iasValue !== null ||
    machNum !== null ||
    (windDir !== null && windSpd !== null) ||
    oatC !== null ||
    (rollDeg !== null && Math.abs(rollDeg) > 1) ||
    (trackRateVal !== null && Math.abs(trackRateVal) >= 0.1) ||
    qnhValue !== null;

  const hasAutopilot =
    (navModes !== null && navModes.length > 0) ||
    mcpAlt !== null ||
    fmsAlt !== null ||
    selHdg !== null;

  if (!hasFlightData && !hasAutopilot) return null;

  const altUnit = altitudeUnitLabel(unitSystem);
  const spdUnit = speedUnitLabel(unitSystem);

  const bankText =
    rollDeg !== null && Math.abs(rollDeg) > 1
      ? `${rollDeg > 0 ? "R" : "L"}${Math.round(Math.abs(rollDeg))}°`
      : null;
  const turnText =
    trackRateVal !== null && Math.abs(trackRateVal) >= 0.1
      ? `${trackRateVal > 0 ? "R" : "L"}${Math.abs(trackRateVal).toFixed(1)}°/s`
      : null;
  const bankDisplay = [bankText, turnText].filter(Boolean).join(" · ") || null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-3 rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] px-3.5 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:bg-foreground/[0.045] active:bg-foreground/[0.07]"
        aria-expanded={open}
        aria-label={open ? "Collapse avionics panel" : "Expand avionics panel"}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.06] bg-background/45 text-foreground/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <Gauge className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground/72">
              Avionics & Autopilot
            </span>
            {navModes && navModes.length > 0 && (
              <span className="flex items-center gap-1">
                {navModes.slice(0, 2).map((mode) => (
                  <span
                    key={mode}
                    className={`inline-flex h-4 items-center rounded-full border px-1.5 text-[8px] font-semibold uppercase tracking-wide ${navModeStyle(mode)}`}
                  >
                    {navModeLabel(mode)}
                  </span>
                ))}
                {navModes.length > 2 && (
                  <span className="text-[9px] text-foreground/35">
                    +{navModes.length - 2}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={`ml-auto h-4 w-4 text-foreground/24 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="avionics"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-4 rounded-b-[22px] border-x border-b border-foreground/[0.07] bg-foreground/[0.025] px-3 pb-3 pt-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
              {/* ── Flight Instruments ── */}
              {hasFlightData && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 px-0.5">
                    <div className="h-px w-3 bg-foreground/10" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/35">
                      Flight Instruments
                    </span>
                    <div className="h-px flex-1 bg-foreground/10" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {iasValue !== null && (
                      <DataCard
                        icon={<Gauge className="h-3 w-3" />}
                        label="Airspeed"
                        value={iasValue}
                        unit={spdUnit}
                      />
                    )}
                    {machNum !== null && (
                      <DataCard
                        icon={<Zap className="h-3 w-3" />}
                        label="Mach"
                        value={machNum.toFixed(2)}
                      />
                    )}
                    {windDir !== null && windSpd !== null && (
                      <DataCard
                        icon={<Wind className="h-3 w-3" />}
                        label="Wind"
                        value={`${Math.round(windDir)}° / ${Math.round(windSpd)}`}
                        unit={spdUnit}
                      />
                    )}
                    {oatC !== null && (
                      <DataCard
                        icon={<Thermometer className="h-3 w-3" />}
                        label="OAT"
                        value={formatTemperatureC(oatC, unitSystem)}
                      />
                    )}
                    {bankDisplay && (
                      <DataCard
                        icon={<Navigation className="h-3 w-3" />}
                        label="Bank"
                        value={bankDisplay}
                      />
                    )}
                    {qnhValue !== null && (
                      <DataCard
                        icon={<Compass className="h-3 w-3" />}
                        label="Altimeter"
                        value={formatPressureHpa(qnhValue, unitSystem)}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* ── Autopilot ── */}
              {hasAutopilot && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 px-0.5">
                    <div className="h-px w-3 bg-foreground/10" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/35">
                      Autopilot
                    </span>
                    <div className="h-px flex-1 bg-foreground/10" />
                  </div>

                  {navModes !== null && navModes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {navModes.map((mode) => (
                        <ModeBadge key={mode} mode={mode} />
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    {mcpAlt !== null && (
                      <DataCard
                        icon={<Target className="h-3 w-3" />}
                        label="MCP ALT"
                        value={mcpAlt.toLocaleString()}
                        unit={altUnit}
                        highlight
                      />
                    )}
                    {fmsAlt !== null &&
                      (mcpAlt === null || fmsAlt !== mcpAlt) && (
                        <DataCard
                          icon={<Target className="h-3 w-3" />}
                          label="FMS ALT"
                          value={fmsAlt.toLocaleString()}
                          unit={altUnit}
                          highlight
                        />
                      )}
                    {selHdg !== null && (
                      <DataCard
                        icon={<Compass className="h-3 w-3" />}
                        label="SEL HDG"
                        value={`${selHdg}°`}
                        highlight
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

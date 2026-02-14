"use client";

import { motion, AnimatePresence } from "motion/react";
import { Plane, ArrowUp, ArrowDown, Gauge, Compass, Globe } from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import {
  metersToFeet,
  msToKnots,
  formatCallsign,
  headingToCardinal,
} from "@/lib/flight-utils";

type FlightCardProps = {
  flight: FlightState | null;
  x: number;
  y: number;
};

export function FlightCard({ flight, x, y }: FlightCardProps) {
  return (
    <AnimatePresence>
      {flight && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 8 }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 28,
            mass: 0.8,
          }}
          className="pointer-events-none fixed z-50 w-64 sm:w-72"
          role="status"
          aria-live="polite"
          style={{
            left: `clamp(8px, ${x + 16}px, calc(100vw - 272px))`,
            top: `clamp(8px, ${y - 8}px, calc(100vh - 280px))`,
          }}
        >
          <div className="rounded-2xl border border-white/8 bg-black/60 p-4 shadow-2xl shadow-black/40 backdrop-blur-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/6">
                  <Plane className="h-4 w-4 text-white/80" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-wide text-white">
                    {formatCallsign(flight.callsign)}
                  </p>
                  <p className="text-[11px] font-medium tracking-wider text-white/40 uppercase">
                    {flight.icao24}
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-400 uppercase">
                Live
              </span>
            </div>

            <div className="mt-4 h-px bg-linear-to-r from-transparent via-white/6 to-transparent" />

            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <Metric
                icon={<ArrowUp className="h-3 w-3" />}
                label="Altitude"
                value={metersToFeet(flight.baroAltitude)}
              />
              <Metric
                icon={<Gauge className="h-3 w-3" />}
                label="Speed"
                value={msToKnots(flight.velocity)}
              />
              <Metric
                icon={<Compass className="h-3 w-3" />}
                label="Heading"
                value={
                  flight.trueTrack !== null
                    ? `${Math.round(flight.trueTrack)}° ${headingToCardinal(flight.trueTrack)}`
                    : "—"
                }
              />
              <Metric
                icon={<ArrowDown className="h-3 w-3" />}
                label="V/S"
                value={
                  flight.verticalRate !== null
                    ? `${flight.verticalRate > 0 ? "+" : ""}${Math.round(flight.verticalRate)} m/s`
                    : "—"
                }
              />
            </div>

            <div className="mt-3.5 h-px bg-linear-to-r from-transparent via-white/6 to-transparent" />

            <div className="mt-3 flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-white/30" />
              <p className="text-[11px] font-medium tracking-wide text-white/40">
                {flight.originCountry}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-white/30">
        {icon}
        <span className="text-[10px] font-medium tracking-wider uppercase">
          {label}
        </span>
      </div>
      <p className="text-[13px] font-semibold tracking-tight text-white/90">
        {value}
      </p>
    </div>
  );
}

"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  Plane,
  ArrowUp,
  ArrowDown,
  Gauge,
  Compass,
  Globe,
  X,
  Navigation,
  Building2,
} from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import {
  metersToFeet,
  msToKnots,
  formatCallsign,
  headingToCardinal,
} from "@/lib/flight-utils";
import { lookupAirline, parseFlightNumber } from "@/lib/airlines";

type FlightCardProps = {
  flight: FlightState | null;
  onClose: () => void;
};

export function FlightCard({ flight, onClose }: FlightCardProps) {
  const airline = flight ? lookupAirline(flight.callsign) : null;
  const flightNum = flight ? parseFlightNumber(flight.callsign) : null;
  const heading = flight?.trueTrack ?? null;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;

  return (
    <AnimatePresence mode="wait">
      {flight && (
        <motion.div
          key={flight.icao24}
          initial={{ opacity: 0, x: -16, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -16, scale: 0.96 }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 28,
            mass: 0.8,
          }}
          className="w-64 sm:w-72"
          role="complementary"
          aria-label="Selected flight details"
          aria-live="polite"
        >
          <div className="rounded-2xl border border-white/8 bg-black/60 p-4 shadow-2xl shadow-black/40 backdrop-blur-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
                  <Plane className="h-4 w-4 text-sky-400/80" />
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.6)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-wide text-white">
                    {formatCallsign(flight.callsign)}
                  </p>
                  <p className="text-[11px] font-medium tracking-wider text-white/40 uppercase">
                    {flight.icao24}
                    {flightNum ? ` · #${flightNum}` : ""}
                  </p>
                </div>
              </div>
              <motion.button
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/6 transition-colors hover:bg-white/12"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label="Deselect flight"
              >
                <X className="h-3 w-3 text-white/40" />
              </motion.button>
            </div>

            {airline && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-white/25" />
                <p className="text-[11px] font-semibold tracking-wide text-white/55">
                  {airline}
                </p>
              </div>
            )}

            <div className="mt-3 h-px bg-linear-to-r from-transparent via-white/6 to-transparent" />

            <div className="mt-3 grid grid-cols-2 gap-3">
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
                  heading !== null ? `${Math.round(heading)}° ${cardinal}` : "—"
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

            <div className="mt-3 h-px bg-linear-to-r from-transparent via-white/6 to-transparent" />

            <div className="mt-2.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Globe className="h-3 w-3 text-white/25" />
                <p className="text-[11px] font-medium tracking-wide text-white/40">
                  {flight.originCountry}
                </p>
              </div>
              {cardinal && (
                <div className="flex items-center gap-1.5">
                  <Navigation
                    className="h-3 w-3 text-white/25"
                    style={{
                      transform:
                        heading !== null ? `rotate(${heading}deg)` : undefined,
                    }}
                  />
                  <p className="text-[11px] font-medium tracking-wide text-white/40">
                    Heading {cardinal}
                    {flight.latitude !== null && flight.longitude !== null && (
                      <span className="text-white/20">
                        {" "}
                        · {Math.abs(flight.latitude).toFixed(2)}°
                        {flight.latitude >= 0 ? "N" : "S"},{" "}
                        {Math.abs(flight.longitude).toFixed(2)}°
                        {flight.longitude >= 0 ? "E" : "W"}
                      </span>
                    )}
                  </p>
                </div>
              )}
              {flight.squawk && (
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-3 w-3 text-center text-[8px] font-bold leading-3 ${
                      isEmergencySquawk(flight.squawk)
                        ? "text-red-400"
                        : "text-white/25"
                    }`}
                  >
                    SQ
                  </span>
                  <p
                    className={`font-mono text-[11px] font-medium tracking-wide ${
                      isEmergencySquawk(flight.squawk)
                        ? "text-red-400"
                        : "text-white/40"
                    }`}
                  >
                    {flight.squawk}
                    {isEmergencySquawk(flight.squawk) && (
                      <span className="ml-1.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-red-400 uppercase">
                        {squawkLabel(flight.squawk)}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);

function isEmergencySquawk(squawk: string | null): boolean {
  if (!squawk) return false;
  return EMERGENCY_SQUAWKS.has(squawk.trim());
}

function squawkLabel(squawk: string): string {
  switch (squawk.trim()) {
    case "7500":
      return "Hijack";
    case "7600":
      return "Radio fail";
    case "7700":
      return "Emergency";
    default:
      return "";
  }
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

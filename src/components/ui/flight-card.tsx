"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowUp,
  ArrowDown,
  Gauge,
  Compass,
  Globe,
  X,
  Navigation,
  Building2,
  Eye,
} from "lucide-react";
import type { FlightState } from "@/lib/opensky";
import {
  metersToFeet,
  msToKnots,
  formatCallsign,
  headingToCardinal,
} from "@/lib/flight-utils";
import { lookupAirline, parseFlightNumber } from "@/lib/airlines";
import { aircraftTypeHint } from "@/lib/aircraft";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import {
  loadedAirlineLogoUrls,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/lib/logo-cache";

type FlightCardProps = {
  flight: FlightState | null;
  onClose: () => void;
  onToggleFpv?: (icao24: string) => void;
  isFpvActive?: boolean;
};

export function FlightCard({
  flight,
  onClose,
  onToggleFpv,
  isFpvActive = false,
}: FlightCardProps) {
  const airline = flight ? lookupAirline(flight.callsign) : null;
  const flightNum = flight ? parseFlightNumber(flight.callsign) : null;
  const company =
    airline ?? (flight ? `${flight.originCountry} operator` : null);
  const model = flight ? aircraftTypeHint(flight.category) : null;
  const logoCandidates = airlineLogoCandidates(airline);
  const heading = flight?.trueTrack ?? null;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const canEnterFpv =
    flight != null &&
    flight.longitude != null &&
    flight.latitude != null &&
    !flight.onGround;
  const [logoIndexByAirline, setLogoIndexByAirline] = useState<
    Record<string, number>
  >({});
  const [logoLoadedByKey, setLogoLoadedByKey] = useState<
    Record<string, boolean>
  >({});
  const [genericLogoFailed, setGenericLogoFailed] = useState(false);
  const airlineKey = airline ?? "__none__";
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

  const logoLoadKey = `${airlineKey}:${resolvedLogoIndex}`;
  const logoUrl = logoCandidates[resolvedLogoIndex] ?? null;
  const logoLoaded =
    (logoUrl ? loadedAirlineLogoUrls.has(logoUrl) : false) ||
    (logoLoadedByKey[logoLoadKey] ?? false);
  const showLogo = Boolean(logoUrl);
  const genericLogoUrl = "/airline-logos/envoy-air.png";

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
          className="w-72 sm:w-80"
          role="complementary"
          aria-label="Selected flight details"
          aria-live="polite"
        >
          <div className="rounded-2xl border border-white/8 bg-black/60 p-4 shadow-2xl shadow-black/40 backdrop-blur-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-white/14 bg-white/10 shadow-lg shadow-black/25">
                  {showLogo ? (
                    <span className="relative flex h-18 w-18 items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-white/95 p-3.5 shadow-sm">
                      {!logoLoaded && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 animate-pulse bg-linear-to-br from-white/85 via-neutral-200/65 to-white/80"
                        />
                      )}
                      <Image
                        src={logoUrl ?? undefined}
                        alt={company ? `${company} logo` : "Airline logo"}
                        width={68}
                        height={68}
                        className={`relative h-13 w-13 object-contain transition-opacity duration-200 ${
                          logoLoaded ? "opacity-100" : "opacity-0"
                        }`}
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
                    <span className="relative flex h-18 w-18 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/95 p-3.5 shadow-sm">
                      {genericLogoFailed ? (
                        <span className="text-[22px] font-semibold text-black/25">
                          —
                        </span>
                      ) : (
                        <Image
                          src={genericLogoUrl}
                          alt="Generic airline logo"
                          width={68}
                          height={68}
                          className="h-13 w-13 object-contain grayscale opacity-80"
                          unoptimized
                          onError={() => setGenericLogoFailed(true)}
                        />
                      )}
                    </span>
                  )}
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
              <div className="flex items-center gap-1.5">
                {onToggleFpv && (
                  <motion.button
                    onClick={() =>
                      (isFpvActive || canEnterFpv) &&
                      flight &&
                      onToggleFpv(flight.icao24)
                    }
                    disabled={!isFpvActive && !canEnterFpv}
                    className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                      isFpvActive
                        ? "bg-emerald-500/20 text-emerald-400"
                        : !canEnterFpv
                          ? "bg-white/4 text-white/15 cursor-not-allowed"
                          : "bg-white/6 text-white/40 hover:bg-white/12"
                    }`}
                    whileHover={
                      isFpvActive || canEnterFpv ? { scale: 1.1 } : {}
                    }
                    whileTap={isFpvActive || canEnterFpv ? { scale: 0.9 } : {}}
                    aria-label={
                      isFpvActive
                        ? "Exit first person view"
                        : canEnterFpv
                          ? "First person view"
                          : "First person view unavailable"
                    }
                    title={
                      isFpvActive
                        ? "Exit FPV (F)"
                        : canEnterFpv
                          ? "First Person View (F)"
                          : flight?.onGround
                            ? "FPV unavailable (aircraft on ground)"
                            : "FPV unavailable (no position data)"
                    }
                  >
                    <Eye className="h-3 w-3" />
                  </motion.button>
                )}
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
            </div>

            {company && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-white/25" />
                <p className="text-[11px] font-semibold tracking-wide text-white/55">
                  {company}
                  {model ? (
                    <span className="text-white/30"> · {model}</span>
                  ) : null}
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
                  heading !== null && Number.isFinite(heading)
                    ? `${Math.round(heading)}° ${cardinal}`
                    : "—"
                }
              />
              <Metric
                icon={<ArrowDown className="h-3 w-3" />}
                label="V/S"
                value={
                  flight.verticalRate !== null &&
                  Number.isFinite(flight.verticalRate)
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
                        heading !== null && Number.isFinite(heading)
                          ? `rotate(${heading}deg)`
                          : undefined,
                    }}
                  />
                  <p className="text-[11px] font-medium tracking-wide text-white/40">
                    Heading {cardinal}
                    {flight.latitude !== null &&
                      flight.longitude !== null &&
                      Number.isFinite(flight.latitude) &&
                      Number.isFinite(flight.longitude) && (
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

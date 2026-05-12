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
  ChevronRight,
  ChevronDown,
  Plane,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
import type { FlightRouteInfo } from "@/hooks/use-route-info";
import { AircraftPhotos } from "@/components/ui/aircraft-photos";
import { HeroBanner } from "@/components/ui/hero-banner";
import type { FlightState, FlightTrack } from "@/lib/opensky";
import { VerticalProfile } from "@/components/ui/vertical-profile";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { useSettings } from "@/hooks/use-settings";
import {
  formatCallsign,
  headingToCardinal,
} from "@/lib/flight-utils";
import { lookupAirline, parseFlightNumber } from "@/lib/airlines";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import {
  loadedAirlineLogoUrls,
  trackAirlineLogoLoaded,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/lib/logo-cache";
import { useRouteInfo } from "@/hooks/use-route-info";
import { formatAirportCode } from "@/lib/route-lookup";
import {
  PositionSourceBadge,
  OnGroundBadge,
  AircraftTypeLine,
  AircraftOperatorLine,
} from "@/components/ui/flight-badges";
import {
  formatAltitude,
  formatSpeed,
  formatVerticalSpeed,
} from "@/lib/unit-formatters";

type FlightCardProps = {
  flight: FlightState | null;
  trail?: TrailEntry | null;
  track?: FlightTrack | null;
  onClose: () => void;
  onToggleFpv?: (icao24: string) => void;
  isFpvActive?: boolean;
};

export function FlightCard({
  flight,
  trail,
  track,
  onClose,
  onToggleFpv,
  isFpvActive = false,
}: FlightCardProps) {
  const { settings } = useSettings();
  const routeInfo = useRouteInfo(flight);
  const airline = flight ? lookupAirline(flight.callsign) : null;
  const flightNum = flight ? parseFlightNumber(flight.callsign) : null;
  const company =
    airline ?? (flight ? `${flight.originCountry} operator` : null);
  // Type display uses typeCode/typeDescription from API; aircraftTypeHint is fallback
  const logoCandidates = airlineLogoCandidates(airline, flight?.callsign);
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

  const {
    photos,
    aircraft: photoAircraft,
    loading: photosLoading,
    error: photosError,
  } = useAircraftPhotos(flight?.icao24 ?? null, flight?.registration);
  const heroPhoto = photos[0] ?? null;
  const [vpOpen, setVpOpen] = useState(false);

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
          <div className="overflow-hidden rounded-2xl border border-foreground/8 bg-background/60 shadow-2xl shadow-background/40 backdrop-blur-2xl">
            <HeroBanner photo={heroPhoto} loading={photosLoading} />

            <div className="flex max-h-[calc(100vh-140px)] flex-col">
              {/* ── Fixed Header ── */}
              <div className="shrink-0 p-4 pb-3">
                <div className="flex items-start gap-3">
                  {/* Logo */}
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/[0.06] shadow-md shadow-background/20">
                    {showLogo ? (
                      <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-background/10 bg-white/95 p-2.5 shadow-sm">
                        {!logoLoaded && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-0 animate-pulse bg-linear-to-br from-white/85 via-neutral-200/65 to-white/80"
                          />
                        )}
                        <Image
                          src={logoUrl ?? undefined}
                          alt={company ? `${company} logo` : "Airline logo"}
                          width={48}
                          height={48}
                          className={`relative h-9 w-9 object-contain transition-opacity duration-200 ${
                            logoLoaded ? "opacity-100" : "opacity-0"
                          }`}
                          unoptimized
                          onLoad={() => {
                            if (logoUrl) trackAirlineLogoLoaded(logoUrl);
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
                      <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-white/95 p-2.5 shadow-sm">
                        {genericLogoFailed ? (
                          <span className="text-[18px] font-semibold text-background/25">
                            -
                          </span>
                        ) : (
                          <Image
                            src={genericLogoUrl}
                            alt="Generic airline logo"
                            width={48}
                            height={48}
                            className="h-9 w-9 object-contain grayscale opacity-80"
                            unoptimized
                            onError={() => setGenericLogoFailed(true)}
                          />
                        )}
                      </span>
                    )}
                  </div>

                  {/* Text */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[17px] font-bold leading-tight tracking-tight text-foreground">
                        {formatCallsign(flight.callsign)}
                      </p>
                      <PositionSourceBadge source={flight.positionSource} />
                      <OnGroundBadge onGround={flight.onGround} />
                    </div>
                    {company && (
                      <p className="mt-0.5 truncate text-[13px] font-medium text-foreground/50">
                        {company}
                      </p>
                    )}
                    <AircraftTypeLine
                      typeCode={flight.typeCode}
                      typeDescription={flight.typeDescription}
                      registration={flight.registration}
                    />
                    <AircraftOperatorLine
                      manufacturer={photoAircraft?.manufacturer}
                      owner={photoAircraft?.owner}
                      airlineName={company}
                    />
                  </div>
                </div>
              </div>

              {/* ── Scrollable Body ── */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-3">
                  {/* Route */}
                  <RouteBanner routeInfo={routeInfo} />

                  {/* Emergency / Military */}
                  {(isMilitary(flight.dbFlags) ||
                    isEmergencyStatus(flight.emergencyStatus)) && (
                    <div className="flex items-center gap-3">
                      {isMilitary(flight.dbFlags) && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-400/70">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60" />
                          Military
                        </span>
                      )}
                      {isEmergencyStatus(flight.emergencyStatus) && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/8 px-2 py-0.5 text-[10px] font-medium tracking-wide text-red-400/80">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                          {flight.emergencyStatus}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-2">
                    <Metric
                      icon={<ArrowUp className="h-3 w-3" />}
                      label="Altitude"
                      value={formatAltitude(
                        flight.baroAltitude,
                        settings.unitSystem,
                      )}
                    />
                    <Metric
                      icon={<Gauge className="h-3 w-3" />}
                      label="Speed"
                      value={formatSpeed(
                        flight.velocity,
                        settings.unitSystem,
                      )}
                    />
                    <Metric
                      icon={<Compass className="h-3 w-3" />}
                      label="Heading"
                      value={
                        heading !== null && Number.isFinite(heading)
                          ? `${Math.round(heading)}° ${cardinal}`
                          : "-"
                      }
                    />
                    <Metric
                      icon={<ArrowDown className="h-3 w-3" />}
                      label="V/S"
                      value={formatVerticalSpeed(
                        flight.verticalRate,
                        settings.unitSystem,
                      )}
                    />
                  </div>

                  {/* Info rows */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Globe className="h-3 w-3 text-foreground/25" />
                      <p className="text-[11px] text-foreground/40">
                        {flight.originCountry}
                      </p>
                    </div>
                    {cardinal && (
                      <div className="flex items-center gap-1.5">
                        <Navigation
                          className="h-3 w-3 text-foreground/25"
                          style={{
                            transform:
                              heading !== null && Number.isFinite(heading)
                                ? `rotate(${heading}deg)`
                                : undefined,
                          }}
                        />
                        <p className="text-[11px] text-foreground/40">
                          {cardinal}
                          {flight.latitude !== null &&
                            flight.longitude !== null &&
                            Number.isFinite(flight.latitude) &&
                            Number.isFinite(flight.longitude) && (
                              <span className="text-foreground/20">
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
                          className={`inline-flex h-3.5 items-center justify-center rounded px-1 text-[7px] font-bold uppercase tracking-wider ${
                            isEmergencySquawk(flight.squawk)
                              ? "bg-red-500/15 text-red-400"
                              : "bg-foreground/[0.04] text-foreground/25"
                          }`}
                        >
                          SQ
                        </span>
                        <p
                          className={`font-mono text-[11px] tabular-nums ${
                            isEmergencySquawk(flight.squawk)
                              ? "text-red-400"
                              : "text-foreground/40"
                          }`}
                        >
                          {flight.squawk}
                          {isEmergencySquawk(flight.squawk) && (
                            <span className="ml-1.5 text-[9px] font-medium tracking-wide text-red-400/80">
                              {squawkLabel(flight.squawk)}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* FPV */}
                  {onToggleFpv && (
                    <button
                      type="button"
                      onClick={() =>
                        (isFpvActive || canEnterFpv) &&
                        flight &&
                        onToggleFpv(flight.icao24)
                      }
                      disabled={!isFpvActive && !canEnterFpv}
                      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                        isFpvActive
                          ? "border-emerald-500/20 bg-emerald-500/10"
                          : "border-foreground/6 bg-foreground/[0.03]"
                      } ${
                        !isFpvActive && !canEnterFpv
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-foreground/[0.05]"
                      }`}
                      aria-label={
                        isFpvActive
                          ? "Exit first person view"
                          : canEnterFpv
                            ? "First person view"
                            : "First person view unavailable"
                      }
                    >
                      <Eye
                        className={`h-3.5 w-3.5 ${
                          isFpvActive
                            ? "text-emerald-400"
                            : "text-foreground/25"
                        }`}
                      />
                      <span
                        className={`text-[11px] font-medium tracking-wide ${
                          isFpvActive
                            ? "text-emerald-400/80"
                            : "text-foreground/40"
                        }`}
                      >
                        {isFpvActive
                          ? "Exit First Person View"
                          : "First Person View"}
                      </span>
                      <ChevronRight
                        className={`ml-auto h-3 w-3 ${
                          isFpvActive
                            ? "text-emerald-400/40"
                            : "text-foreground/20"
                        }`}
                      />
                    </button>
                  )}

                  {/* Photos */}
                  <AircraftPhotos
                    photos={photos}
                    loading={photosLoading}
                    aircraft={photoAircraft}
                    error={photosError}
                  />

                  {/* Vertical Profile */}
                  {trail && trail.path.length >= 3 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setVpOpen((o) => !o)}
                        className="flex w-full items-center gap-2 rounded-xl border border-foreground/6 bg-foreground/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.05]"
                        aria-expanded={vpOpen}
                        aria-label={
                          vpOpen
                            ? "Collapse vertical profile"
                            : "Expand vertical profile"
                        }
                      >
                        <TrendingUp className="h-3.5 w-3.5 text-foreground/25" />
                        <span className="text-[11px] font-medium tracking-wide text-foreground/40">
                          Vertical Profile
                        </span>
                        <ChevronDown
                          className={`ml-auto h-3 w-3 text-foreground/20 transition-transform duration-200 ${vpOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                      <AnimatePresence initial={false}>
                        {vpOpen && (
                          <motion.div
                            key="vp"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            className="overflow-hidden"
                          >
                            <div className="pt-2">
                              <VerticalProfile
                                trail={trail}
                                navAltitudeMcp={flight.navAltitudeMcp}
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Close */}
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex w-full items-center gap-2 rounded-xl border border-foreground/6 bg-foreground/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.05]"
                    aria-label="Deselect flight"
                  >
                    <X className="h-3.5 w-3.5 text-foreground/25" />
                    <span className="text-[11px] font-medium tracking-wide text-foreground/40">
                      Close
                    </span>
                  </button>
                </div>
              </div>
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

function isMilitary(dbFlags?: number | null): boolean {
  return ((dbFlags ?? 0) & 1) !== 0;
}

function isEmergencyStatus(status?: string | null): boolean {
  return !!status && status !== "none";
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
      <div className="flex items-center gap-1.5 text-foreground/25">
        {icon}
        <span className="text-[10px] font-medium tracking-widest uppercase">
          {label}
        </span>
      </div>
      <p className="text-sm font-semibold tabular-nums text-foreground/90">
        {value}
      </p>
    </div>
  );
}

// ── Route Banner ───────────────────────────────────────────────────────

function RouteBanner({ routeInfo }: { routeInfo: FlightRouteInfo }) {
  // Loading state
  if (routeInfo.loading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-foreground/6 bg-foreground/[0.03] px-3.5 py-2.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/25" />
        <span className="text-[11px] text-foreground/30">
          Looking up route…
        </span>
      </div>
    );
  }

  // No verified route available — silently omit the banner
  if (!routeInfo.available) {
    return null;
  }

  const originCode = routeInfo.origin
    ? formatAirportCode(routeInfo.origin)
    : null;
  const destCode = routeInfo.destination
    ? formatAirportCode(routeInfo.destination)
    : null;

  return (
    <div className="mt-3 rounded-xl border border-foreground/6 bg-foreground/[0.03] px-3.5 py-3">
      <div className="flex items-center">
        {/* Origin */}
        <div className="flex min-w-0 flex-1 flex-col">
          {originCode ? (
            <>
              <span className="text-[13px] font-extrabold tracking-wider text-foreground/90">
                {originCode}
              </span>
              {routeInfo.origin?.municipality && (
                <span className="mt-0.5 truncate text-[10px] text-foreground/35">
                  {routeInfo.origin.municipality}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-foreground/20">-</span>
          )}
        </div>

        {/* Flight path indicator */}
        <div className="mx-2 flex items-center gap-1.5">
          <div className="h-px w-5 bg-foreground/10" />
          <Plane className="h-3.5 w-3.5 shrink-0 text-foreground/25" />
          <div className="h-px w-5 bg-foreground/10" />
        </div>

        {/* Destination */}
        <div className="flex min-w-0 flex-1 flex-col items-end text-right">
          {destCode ? (
            <>
              <span className="text-[13px] font-extrabold tracking-wider text-foreground/90">
                {destCode}
              </span>
              {routeInfo.destination?.municipality && (
                <span className="mt-0.5 truncate text-[10px] text-foreground/35">
                  {routeInfo.destination.municipality}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-foreground/20">-</span>
          )}
        </div>
      </div>
    </div>
  );
}

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
  TrendingUp,
} from "lucide-react";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
import { AircraftPhotos } from "@/components/ui/aircraft-photos";
import { HeroBanner } from "@/components/ui/hero-banner";
import {
  OnGroundBadge,
  AircraftOperatorLine,
  AircraftTypeLine,
  PositionSourceBadge,
} from "@/components/ui/flight-badges";
import type { FlightState, FlightTrack } from "@/lib/opensky";
import { VerticalProfile } from "@/components/ui/vertical-profile";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { useSettings } from "@/hooks/use-settings";
import {
  formatCallsign,
  headingToCardinal,
} from "@/lib/flight-utils";
import { lookupAirline, parseFlightNumber } from "@/lib/airlines";
import { aircraftTypeHint } from "@/lib/aircraft";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import {
  loadedAirlineLogoUrls,
  trackAirlineLogoLoaded,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/lib/logo-cache";
import type { FlightRouteInfo } from "@/hooks/use-route-info";
import { useRouteInfo } from "@/hooks/use-route-info";
import { formatAirportCode } from "@/lib/route-lookup";
import { AvionicsSection } from "@/components/ui/avionics-section";
import { DebugDataSection } from "@/components/ui/debug-data-section";
import { FlightWeatherSection } from "@/components/ui/flight-weather-section";
import {
  formatAltitude,
  formatSpeed,
  formatSpeedFromKnots,
  formatVerticalSpeed,
} from "@/lib/unit-formatters";
import { cn } from "@/lib/utils";

type FlightCardProps = {
  flight: FlightState | null;
  trail?: TrailEntry | null;
  track?: FlightTrack | null;
  onClose: () => void;
  onToggleFpv?: (icao24: string) => void;
  isFpvActive?: boolean;
  variant?: "floating" | "sidebar";
};

export function FlightCard({
  flight,
  trail,
  onClose,
  onToggleFpv,
  isFpvActive = false,
  variant = "floating",
}: FlightCardProps) {
  const { settings } = useSettings();
  const routeInfo = useRouteInfo(flight);
  const airline = flight ? lookupAirline(flight.callsign) : null;
  const flightNum = flight ? parseFlightNumber(flight.callsign) : null;
  const company =
    airline ?? (flight ? `${flight.originCountry} operator` : null);
  const model = flight ? aircraftTypeHint(flight.category) : null;
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
  const isSidebar = variant === "sidebar";
  const verticalRate =
    flight?.verticalRate != null && Number.isFinite(flight.verticalRate)
      ? flight.verticalRate
      : flight?.geomRate != null && Number.isFinite(flight.geomRate)
        ? flight.geomRate
        : null;
  const showDebugData =
    settings.showDebugData && hasDebugData(flight?.debugData);
  const hasAircraftMetadata = Boolean(
    flight?.typeCode ||
      flight?.typeDescription ||
      model ||
      flight?.registration ||
      photoAircraft?.manufacturer ||
      photoAircraft?.owner,
  );

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
          className={
            isSidebar
              ? "h-full w-full"
              : "w-[22rem] max-w-[calc(100vw-1rem)] sm:w-[23rem]"
          }
          role="complementary"
          aria-label="Selected flight details"
          aria-live="polite"
        >
          <div
            className={cn(
              "overflow-hidden text-foreground",
              isSidebar
                ? "h-full overflow-y-auto overscroll-contain bg-sidebar/80 [scrollbar-width:thin] supports-[backdrop-filter]:bg-sidebar/70"
                : "rounded-[28px] border border-foreground/[0.08] bg-background/80 shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl supports-[backdrop-filter]:bg-background/70",
            )}
          >
            <HeroBanner
              photo={heroPhoto}
              loading={photosLoading}
            />

            <div className={isSidebar ? "px-5 pb-7 pt-4" : "p-4"}>
              <div className="flex items-center gap-3.5">
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-foreground/[0.08] bg-foreground/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_26px_rgba(0,0,0,0.18)]">
                  {showLogo ? (
                    <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] border border-black/5 bg-white/95 p-3 shadow-sm">
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
                        className={`relative h-11 w-11 object-contain transition-opacity duration-200 ${
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
                    <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] border border-black/5 bg-white/95 p-3 shadow-sm">
                      {genericLogoFailed ? (
                        <span className="text-[22px] font-semibold text-background/25">
                          -
                        </span>
                      ) : (
                        <Image
                          src={genericLogoUrl}
                          alt="Generic airline logo"
                          width={68}
                          height={68}
                          className="h-11 w-11 object-contain grayscale opacity-80"
                          unoptimized
                          onError={() => setGenericLogoFailed(true)}
                        />
                      )}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-[19px] font-semibold leading-tight tracking-tight text-foreground">
                      {formatCallsign(flight.callsign)}
                    </p>
                    <PositionSourceBadge source={flight.positionSource} />
                    <OnGroundBadge onGround={flight.onGround} />
                  </div>
                  <p className="mt-1 truncate text-[11px] font-medium tracking-wide text-foreground/42 uppercase">
                    {flight.icao24}
                    {flightNum ? ` · #${flightNum}` : ""}
                  </p>
                </div>
              </div>

              {(company || hasAircraftMetadata) && (
                <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                  {company && (
                    <GroupedRow icon={<Building2 className="h-3.5 w-3.5" />}>
                      <p className="min-w-0 truncate text-[13px] font-medium text-foreground/78">
                        {company}
                      </p>
                    </GroupedRow>
                  )}

                  {hasAircraftMetadata && (
                    <GroupedRow
                      icon={<Plane className="h-3.5 w-3.5" />}
                      divided={Boolean(company)}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <AircraftTypeLine
                          typeCode={flight.typeCode}
                          typeDescription={flight.typeDescription ?? model}
                          registration={flight.registration}
                        />
                        <AircraftOperatorLine
                          manufacturer={photoAircraft?.manufacturer}
                          owner={photoAircraft?.owner}
                          airlineName={company}
                        />
                      </div>
                    </GroupedRow>
                  )}
                </div>
              )}

              {/* Military / Emergency indicators */}
              {(isMilitary(flight.dbFlags) ||
                isEmergencyStatus(flight.emergencyStatus)) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {isMilitary(flight.dbFlags) && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-amber-300/85">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" />
                      Military
                    </span>
                  )}
                  {isEmergencyStatus(flight.emergencyStatus) && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-red-300/90">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      {flight.emergencyStatus}
                    </span>
                  )}
                </div>
              )}

              <RouteBanner
                routeInfo={routeInfo}
                showSource={settings.showDebugData}
              />

              {routeInfo.available &&
                (routeInfo.origin?.icao || routeInfo.destination?.icao) && (
                  <div className="mt-3">
                    <FlightWeatherSection
                      routeInfo={routeInfo}
                      unitSystem={settings.unitSystem}
                    />
                  </div>
                )}

              <div className="mt-4 grid grid-cols-2 gap-2 rounded-[24px] border border-foreground/[0.07] bg-foreground/[0.035] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <Metric
                  icon={<ArrowUp className="h-3 w-3" />}
                  label="Altitude"
                  value={formatAltitude(
                    flight.baroAltitude,
                    settings.unitSystem,
                  )}
                  secondary={
                    flight.geoAltitude !== null
                      ? `GPS ${formatAltitude(
                          flight.geoAltitude,
                          settings.unitSystem,
                        )}`
                      : null
                  }
                />
                <Metric
                  icon={<Gauge className="h-3 w-3" />}
                  label="Speed"
                  value={formatSpeed(flight.velocity, settings.unitSystem)}
                  secondary={
                    flight.tas != null && Number.isFinite(flight.tas)
                      ? `TAS ${formatSpeedFromKnots(
                          flight.tas,
                          settings.unitSystem,
                        )}`
                      : null
                  }
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
                    verticalRate,
                    settings.unitSystem,
                  )}
                />
              </div>

              <div className="mt-3">
                <AvionicsSection
                  flight={flight}
                  unitSystem={settings.unitSystem}
                />
              </div>

              <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <GroupedRow icon={<Globe className="h-3.5 w-3.5" />}>
                  <p className="text-[13px] text-foreground/65">
                    {flight.originCountry}
                  </p>
                </GroupedRow>
                {cardinal && (
                  <GroupedRow
                    icon={
                      <Navigation
                        className="h-3.5 w-3.5"
                        style={{
                          transform:
                            heading !== null && Number.isFinite(heading)
                              ? `rotate(${heading}deg)`
                              : undefined,
                        }}
                      />
                    }
                    divided
                  >
                    <p className="text-[13px] text-foreground/65">
                      Heading {cardinal}
                      {flight.latitude !== null &&
                        flight.longitude !== null &&
                        Number.isFinite(flight.latitude) &&
                        Number.isFinite(flight.longitude) && (
                          <span className="text-foreground/35">
                            {" "}
                            · {Math.abs(flight.latitude).toFixed(2)}°
                            {flight.latitude >= 0 ? "N" : "S"},{" "}
                            {Math.abs(flight.longitude).toFixed(2)}°
                            {flight.longitude >= 0 ? "E" : "W"}
                          </span>
                        )}
                    </p>
                  </GroupedRow>
                )}
                {flight.squawk && (
                  <GroupedRow
                    icon={
                      <span
                        className={`text-[9px] font-bold leading-none ${
                          isEmergencySquawk(flight.squawk)
                            ? "text-red-300"
                            : "text-foreground/45"
                        }`}
                      >
                        SQ
                      </span>
                    }
                    divided
                  >
                    <p
                      className={`font-mono text-[13px] tabular-nums ${
                        isEmergencySquawk(flight.squawk)
                          ? "text-red-300"
                          : "text-foreground/65"
                      }`}
                    >
                      {flight.squawk}
                      {isEmergencySquawk(flight.squawk) && (
                        <span className="ml-2 font-sans text-[11px] font-medium tracking-wide text-red-300/85">
                          {squawkLabel(flight.squawk)}
                        </span>
                      )}
                    </p>
                  </GroupedRow>
                )}
              </div>

              {showDebugData && (
                <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                  <DebugDataSection data={flight.debugData} />
                </div>
              )}

              {onToggleFpv && (
                <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                  <button
                    type="button"
                    onClick={() =>
                      (isFpvActive || canEnterFpv) &&
                      flight &&
                      onToggleFpv(flight.icao24)
                    }
                    disabled={!isFpvActive && !canEnterFpv}
                    className={`flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] active:bg-foreground/[0.07] ${
                      !isFpvActive && !canEnterFpv
                        ? "cursor-not-allowed opacity-35"
                        : ""
                    }`}
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
                    <IconCell active={isFpvActive}>
                      <Eye
                        className={`h-3.5 w-3.5 ${isFpvActive ? "text-emerald-300" : ""}`}
                      />
                    </IconCell>
                    <span
                      className={`min-w-0 flex-1 text-[13px] font-medium ${isFpvActive ? "text-emerald-300/90" : "text-foreground/72"}`}
                    >
                      {isFpvActive
                        ? "Exit First Person View"
                        : "First Person View"}
                    </span>
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 ${isFpvActive ? "text-emerald-300/45" : "text-foreground/24"}`}
                    />
                  </button>
                </div>
              )}

              <AircraftPhotos
                photos={photos}
                loading={photosLoading}
                aircraft={photoAircraft}
                error={photosError}
              />

              {trail && trail.path.length >= 3 && (
                <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                  <button
                    type="button"
                    onClick={() => setVpOpen((o) => !o)}
                    className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] active:bg-foreground/[0.07]"
                    aria-expanded={vpOpen}
                    aria-label={
                      vpOpen
                        ? "Collapse vertical profile"
                        : "Expand vertical profile"
                    }
                  >
                    <IconCell>
                      <TrendingUp className="h-3.5 w-3.5" />
                    </IconCell>
                    <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground/72">
                      Vertical Profile
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-foreground/24 transition-transform duration-200 ${vpOpen ? "rotate-180" : ""}`}
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
                        className="overflow-hidden border-t border-foreground/[0.06]"
                      >
                        <div className="px-3 pb-3 pt-2">
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

              <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] active:bg-foreground/[0.07]"
                  aria-label="Deselect flight"
                >
                  <IconCell>
                    <X className="h-3.5 w-3.5" />
                  </IconCell>
                  <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground/72">
                    Close
                  </span>
                </button>
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

function hasDebugData(data: FlightState["debugData"]): boolean {
  return !!(
    data &&
    (data.nic != null ||
      data.nacP != null ||
      data.nacV != null ||
      data.sil != null ||
      data.version != null ||
      (data.alert != null && data.alert !== 0) ||
      data.messages != null ||
      data.seen != null ||
      data.rssi != null)
  );
}

function IconCell({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.06] bg-background/45 text-foreground/36 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
        active &&
          "border-emerald-300/20 bg-emerald-400/10 text-emerald-300/90",
      )}
    >
      {children}
    </span>
  );
}

function GroupedRow({
  icon,
  children,
  divided = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  divided?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center gap-3 px-3.5 py-2.5",
        divided && "border-t border-foreground/[0.06]",
      )}
    >
      <IconCell>{icon}</IconCell>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  secondary,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  secondary?: string | null;
}) {
  return (
    <div className="flex min-h-[78px] flex-col justify-between rounded-[18px] border border-foreground/[0.055] bg-background/35 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center gap-1.5 text-foreground/38">
        {icon}
        <span className="text-[10px] font-semibold tracking-wide uppercase">
          {label}
        </span>
      </div>
      <p className="mt-2 text-[15px] font-semibold leading-none tabular-nums text-foreground/92">
        {value}
      </p>
      {secondary ? (
        <p className="mt-1 truncate text-[10px] font-medium text-foreground/42">
          {secondary}
        </p>
      ) : null}
    </div>
  );
}

function RouteBanner({
  routeInfo,
  showSource = false,
}: {
  routeInfo: FlightRouteInfo;
  showSource?: boolean;
}) {
  if (!routeInfo.available) return null;

  const originCode = routeInfo.origin
    ? formatAirportCode(routeInfo.origin)
    : null;
  const destCode = routeInfo.destination
    ? formatAirportCode(routeInfo.destination)
    : null;

  if (!originCode && !destCode) return null;

  return (
    <div className="mt-4 rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex items-center">
        <div className="flex min-w-0 flex-1 flex-col">
          {originCode ? (
            <>
              <span className="text-[17px] font-semibold tracking-tight text-foreground/92">
                {originCode}
              </span>
              {routeInfo.origin?.municipality && (
                <span className="mt-0.5 truncate text-[11px] font-medium text-foreground/42">
                  {routeInfo.origin.municipality}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-foreground/20">-</span>
          )}
        </div>

        <div className="mx-2 flex items-center gap-1.5">
          <div className="h-px w-5 bg-foreground/12" />
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/40 text-foreground/42 ring-1 ring-foreground/[0.06]">
            <Plane className="h-3.5 w-3.5 shrink-0" />
          </span>
          <div className="h-px w-5 bg-foreground/12" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-end text-right">
          {destCode ? (
            <>
              <span className="text-[17px] font-semibold tracking-tight text-foreground/92">
                {destCode}
              </span>
              {routeInfo.destination?.municipality && (
                <span className="mt-0.5 truncate text-[11px] font-medium text-foreground/42">
                  {routeInfo.destination.municipality}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-foreground/20">-</span>
          )}
        </div>
      </div>

      {showSource && routeInfo.source && (
        <div className="mt-2 flex justify-center">
          <span className="rounded-full border border-foreground/[0.06] bg-background/30 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground/35">
            {routeInfo.source}
          </span>
        </div>
      )}
    </div>
  );
}

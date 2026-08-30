"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Eye, Plane, X } from "lucide-react";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
import type {
  AircraftDetails,
  NormalizedPhoto,
} from "@/hooks/use-aircraft-photos";
import type { FlightState, FlightTrack } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { useSettings, type UnitSystem } from "@/hooks/use-settings";
import { headingToCardinal } from "@/lib/flight-utils";
import { lookupAirline, parseFlightNumber } from "@/lib/airlines";
import type { FlightRouteInfo } from "@/hooks/use-route-info";
import { useRouteInfo } from "@/hooks/use-route-info";
import { formatAirportCode } from "@/lib/route-lookup";
import {
  formatAltitude,
  formatSpeed,
  formatSpeedFromKnots,
  formatVerticalSpeed,
} from "@/lib/unit-formatters";
import {
  buildAircraftSidebarViewModel,
  formatAircraftDataSources,
  formatAircraftFreshness,
} from "@/lib/aircraft-sidebar";
import { AirlineLogo } from "@/components/ui/airline-logo";
import { PositionSourceBadge } from "@/components/ui/flight-badges";
import { HeroBanner } from "@/components/ui/hero-banner";
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
  onClose,
  onToggleFpv,
  isFpvActive = false,
  variant = "floating",
}: FlightCardProps) {
  const { settings } = useSettings();
  const routeInfo = useRouteInfo(flight);
  const airline = flight ? lookupAirline(flight.callsign) : null;
  const {
    photos,
    aircraft: photoAircraft,
    loading: photosLoading,
  } = useAircraftPhotos(flight?.icao24 ?? null, flight?.registration);

  const cardContent = flight ? (
    <FlightCardContent
      flight={flight}
      airline={airline}
      photoAircraft={photoAircraft}
      heroPhoto={photos[0] ?? null}
      photosLoading={photosLoading}
      routeInfo={routeInfo}
      unitSystem={settings.unitSystem}
      showDebugData={settings.showDebugData}
      onClose={onClose}
      onToggleFpv={onToggleFpv}
      isFpvActive={isFpvActive}
      isSidebar={variant === "sidebar"}
    />
  ) : null;

  if (variant === "sidebar") {
    return flight ? (
      <div
        className="h-full w-full"
        role="complementary"
        aria-label="Selected aircraft details"
      >
        {cardContent}
      </div>
    ) : null;
  }

  return (
    <AnimatePresence mode="wait">
      {flight && (
        <motion.div
          key={flight.icao24}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-[22rem] max-w-[calc(100vw-1rem)]"
          role="complementary"
          aria-label="Selected aircraft details"
        >
          {cardContent}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type FlightCardContentProps = {
  flight: FlightState;
  airline: string | null;
  photoAircraft: AircraftDetails | null;
  heroPhoto: NormalizedPhoto | null;
  photosLoading: boolean;
  routeInfo: FlightRouteInfo;
  unitSystem: UnitSystem;
  showDebugData: boolean;
  onClose: () => void;
  onToggleFpv?: (icao24: string) => void;
  isFpvActive: boolean;
  isSidebar: boolean;
};

function FlightCardContent({
  flight,
  airline,
  photoAircraft,
  heroPhoto,
  photosLoading,
  routeInfo,
  unitSystem,
  showDebugData,
  onClose,
  onToggleFpv,
  isFpvActive,
  isSidebar,
}: FlightCardContentProps) {
  const details = buildAircraftSidebarViewModel(
    flight,
    airline,
    photoAircraft,
  );
  const updatedAt =
    flight.provenance.observationTime ?? flight.provenance.responseTime;
  const freshness = useFreshness(updatedAt);
  const sources = formatAircraftDataSources(
    flight.provenance.contributingSources,
  );
  const flightNumber = details.airline
    ? parseFlightNumber(flight.callsign)
    : null;
  const heading = flight.trueTrack;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const verticalRate = finiteValue(flight.verticalRate ?? flight.geomRate);
  const canEnterFpv =
    flight.longitude !== null &&
    flight.latitude !== null &&
    !flight.onGround;
  const identity =
    cleanText(flight.callsign) ??
    details.registration ??
    flight.icao24.toUpperCase();
  const statusItems = [
    flight.onGround ? "On ground" : "Airborne",
    isMilitary(flight.dbFlags) ? "Military" : null,
    isEmergencyStatus(flight.emergencyStatus)
      ? flight.emergencyStatus
      : null,
  ].filter((value): value is string => Boolean(value));
  const primaryFields = [
    hasPosition(flight)
      ? {
          label: "Position",
          value: formatPosition(flight.latitude, flight.longitude),
        }
      : null,
    finiteValue(flight.baroAltitude) !== null
      ? {
          label: "Altitude",
          value: formatAltitude(flight.baroAltitude, unitSystem),
        }
      : null,
    finiteValue(flight.velocity) !== null
      ? {
          label: "Speed",
          value: formatSpeed(flight.velocity, unitSystem),
        }
      : null,
    { label: "Status", value: statusItems.join(", ") },
  ].filter((field): field is { label: string; value: string } => field !== null);

  return (
    <div
      className={cn(
        "h-full overflow-y-auto overscroll-contain text-foreground [scrollbar-width:thin]",
        isSidebar
          ? "bg-sidebar/80 supports-[backdrop-filter]:bg-sidebar/70"
          : "rounded-2xl border border-foreground/10 bg-background/90 shadow-2xl backdrop-blur-xl",
      )}
    >
      <HeroBanner
        photo={heroPhoto}
        loading={photosLoading}
        alt={`${identity} aircraft`}
      />

      <div className="px-5 pb-5 pt-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-foreground/[0.08] bg-foreground/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {airline ? (
              <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] border border-black/5 bg-white/95 shadow-sm">
                <AirlineLogo
                  callsign={flight.callsign}
                  airlineName={airline}
                  size={40}
                  className="rounded-none bg-transparent"
                />
              </span>
            ) : (
              <Plane
                className="h-7 w-7 text-foreground/45"
                aria-hidden="true"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="truncate text-[19px] font-semibold leading-tight tracking-tight">
                {identity}
              </h3>
              <PositionSourceBadge source={flight.positionSource} />
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-foreground/45">
              <span className="truncate">ICAO {flight.icao24}</span>
              {flightNumber && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">Flight {flightNumber}</span>
                </>
              )}
            </p>
            {details.airline && (
              <p className="mt-1 truncate text-[12px] text-foreground/62">
                {details.airline}
              </p>
            )}
          </div>

          {!isSidebar && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-foreground/55 transition-colors hover:text-foreground"
              aria-label="Close aircraft details"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <RouteSummary routeInfo={routeInfo} />

        <dl className="mt-3 grid grid-cols-2 overflow-hidden rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.035]">
          {primaryFields.map((field, index) => (
            <PrimaryField
              key={field.label}
              label={field.label}
              value={field.value}
              dividedTop={index >= 2}
              dividedRight={index % 2 === 0 && index < primaryFields.length - 1}
            />
          ))}
        </dl>

        <div className="border-b border-foreground/10 px-0.5 py-3 text-xs text-foreground/65">
          <p aria-live="off" aria-atomic="false">
            {freshness}
          </p>
          {sources.length > 0 && (
            <p className="mt-1">Sources: {sources.join(", ")}</p>
          )}
        </div>

        <details
          key={flight.icao24}
          className="group border-b border-foreground/10"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between py-3 text-sm font-medium marker:content-none">
            Details
            <ChevronDown className="h-4 w-4 text-foreground/45 transition-transform group-open:rotate-180" />
          </summary>
          <dl className="pb-3">
            <DetailRow label="Registration" value={details.registration} />
            <DetailRow
              label="Registration country"
              value={joinValues(
                details.registrationCountryFlag,
                details.registrationCountry,
              )}
            />
            <DetailRow label="Manufacturer" value={details.manufacturer} />
            <DetailRow label="Model" value={details.model} />
            <DetailRow label="Type code" value={details.typeCode} />
            <DetailRow
              label="Heading"
              value={
                finiteValue(heading) !== null
                  ? `${Math.round(heading ?? 0)}° ${cardinal}`
                  : null
              }
            />
            <DetailRow
              label="Vertical speed"
              value={
                verticalRate !== null
                  ? formatVerticalSpeed(verticalRate, unitSystem)
                  : null
              }
            />
            <DetailRow
              label="GPS altitude"
              value={
                finiteValue(flight.geoAltitude) !== null
                  ? formatAltitude(flight.geoAltitude, unitSystem)
                  : null
              }
            />
            <DetailRow
              label="True airspeed"
              value={
                finiteValue(flight.tas) !== null
                  ? formatSpeedFromKnots(flight.tas, unitSystem)
                  : null
              }
            />
            <DetailRow label="Squawk" value={cleanText(flight.squawk)} />
            <DetailRow
              label="Position method"
              value={formatPositionMethod(flight.positionSource)}
            />
            {showDebugData && (
              <>
                <DetailRow
                  label="NACp"
                  value={formatNumber(flight.debugData?.nacP)}
                />
                <DetailRow
                  label="NIC"
                  value={formatNumber(flight.debugData?.nic)}
                />
                <DetailRow
                  label="ADS-B version"
                  value={formatNumber(flight.debugData?.version)}
                />
              </>
            )}
          </dl>
        </details>

        {onToggleFpv && (
          <button
            type="button"
            onClick={() =>
              (isFpvActive || canEnterFpv) && onToggleFpv(flight.icao24)
            }
            disabled={!isFpvActive && !canEnterFpv}
            className="mt-3 flex min-h-10 w-full items-center gap-2 text-left text-sm font-medium text-foreground/70 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={
              isFpvActive
                ? "Exit first person view"
                : canEnterFpv
                  ? "Enter first person view"
                  : "First person view unavailable"
            }
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {isFpvActive ? "Exit first person view" : "First person view"}
          </button>
        )}
      </div>
    </div>
  );
}

export function RouteSummary({ routeInfo }: { routeInfo: FlightRouteInfo }) {
  if (!routeInfo.available) return null;

  const origin = routeInfo.origin ? formatAirportCode(routeInfo.origin) : null;
  const destination = routeInfo.destination
    ? formatAirportCode(routeInfo.destination)
    : null;

  if (!origin || !destination) return null;

  return (
    <section className="mt-4 rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.035] px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/45">
        Reported route
      </p>
      <div className="mt-2 flex items-center gap-3">
        <RouteEndpoint
          code={origin}
          municipality={routeInfo.origin?.municipality}
        />
        <div className="flex shrink-0 items-center gap-1.5 text-foreground/38">
          <span className="h-px w-4 bg-foreground/12" aria-hidden="true" />
          <Plane className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="h-px w-4 bg-foreground/12" aria-hidden="true" />
        </div>
        <RouteEndpoint
          code={destination}
          municipality={routeInfo.destination?.municipality}
          align="right"
        />
      </div>
    </section>
  );
}

function RouteEndpoint({
  code,
  municipality,
  align = "left",
}: {
  code: string;
  municipality?: string | null;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0 flex-1", align === "right" && "text-right")}>
      <p className="text-[17px] font-semibold tracking-tight text-foreground/92">
        {code}
      </p>
      {municipality && (
        <p className="mt-0.5 truncate text-[11px] font-medium text-foreground/45">
          {municipality}
        </p>
      )}
    </div>
  );
}

function PrimaryField({
  label,
  value,
  dividedTop,
  dividedRight,
}: {
  label: string;
  value: string;
  dividedTop: boolean;
  dividedRight: boolean;
}) {
  return (
    <div
      className={cn(
        "min-h-[70px] min-w-0 px-3.5 py-3",
        dividedTop && "border-t border-foreground/[0.06]",
        dividedRight && "border-r border-foreground/[0.06]",
      )}
    >
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-foreground/45">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium tabular-nums text-foreground/90">
        {value}
      </dd>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 border-t border-foreground/[0.06] py-2 text-xs first:border-t-0">
      <dt className="text-foreground/50">{label}</dt>
      <dd className="min-w-0 text-right text-foreground/80">{value}</dd>
    </div>
  );
}

function useFreshness(updatedAt: number): string {
  const [now, setNow] = useState(updatedAt);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return formatAircraftFreshness(updatedAt, now);
}

function hasPosition(
  flight: FlightState,
): flight is FlightState & { latitude: number; longitude: number } {
  return (
    finiteValue(flight.latitude) !== null &&
    finiteValue(flight.longitude) !== null
  );
}

function formatPosition(latitude: number, longitude: number): string {
  const latitudeDirection = latitude >= 0 ? "N" : "S";
  const longitudeDirection = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(2)}°${latitudeDirection}, ${Math.abs(longitude).toFixed(2)}°${longitudeDirection}`;
}

function formatPositionMethod(
  source: FlightState["positionSource"],
): string | null {
  if (!source) return null;
  if (source === "adsb") return "ADS-B";
  return source.toUpperCase();
}

function finiteValue(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function joinValues(
  first: string | null,
  second: string | null,
): string | null {
  const values = [first, second].filter(
    (value): value is string => Boolean(value),
  );
  return values.length > 0 ? values.join(" ") : null;
}

function formatNumber(value: number | null | undefined): string | null {
  return value != null && Number.isFinite(value) ? String(value) : null;
}

function isMilitary(dbFlags?: number | null): boolean {
  return ((dbFlags ?? 0) & 1) !== 0;
}

function isEmergencyStatus(status?: string | null): boolean {
  return Boolean(status && status !== "none");
}

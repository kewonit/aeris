"use client";

import { ArrowRight, ChevronDown, ChevronRight, Plane } from "lucide-react";
import { useAircraftFreshness } from "@/hooks/use-aircraft-freshness";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
import { useSettings } from "@/hooks/use-settings";
import type { FlightRouteInfo } from "@/hooks/use-route-info";
import { useRouteInfo } from "@/hooks/use-route-info";
import type { FlightState } from "@/lib/opensky";
import { isFiniteNumber } from "@/lib/opensky-parsing";
import { headingToCardinal } from "@/lib/flight-utils";
import { lookupAirline } from "@/lib/airlines";
import { formatAirportCode } from "@/lib/route-lookup";
import {
  formatAltitude,
  formatSpeed,
  formatVerticalSpeed,
} from "@/lib/unit-formatters";
import {
  type AircraftDetailRow,
  aircraftVerticalRate,
  buildAircraftDetailRows,
  buildAircraftSidebarViewModel,
  describeMissingRoute,
  formatAircraftDataSources,
  formatAircraftIdentity,
  formatAircraftName,
  hasEmergencyStatus,
  isMilitaryAircraft,
} from "@/lib/aircraft-sidebar";
import { AirlineLogo } from "@/components/ui/airline-logo";
import { HeroBanner } from "@/components/ui/hero-banner";
import { ScrollArea } from "@/components/ui/scroll-area";

type FlightCardProps = {
  flight: FlightState;
  onToggleFpv?: (icao24: string) => void;
};

export function FlightCard({ flight, onToggleFpv }: FlightCardProps) {
  const { settings } = useSettings();
  const units = settings.unitSystem;
  const routeInfo = useRouteInfo(flight);
  const airline = lookupAirline(flight.callsign);
  const { photos, aircraft: photoAircraft, loading: photosLoading } =
    useAircraftPhotos(flight.icao24, flight.registration);
  const details = buildAircraftSidebarViewModel(flight, airline, photoAircraft);
  const freshness = useAircraftFreshness(flight.provenance);
  const sources = formatAircraftDataSources(
    flight.provenance.contributingSources,
  );

  const identity = formatAircraftIdentity(flight, details);
  const aircraftName = formatAircraftName(details);
  // Both lines always render, so details that arrive later (registry,
  // photo metadata) fill them in place instead of pushing content down.
  const subtitle = details.airline ?? aircraftName ?? "Unknown aircraft";
  const airframe =
    [details.airline ? aircraftName : null, details.registration]
      .filter(Boolean)
      .join(" · ") || `ICAO ${flight.icao24.toUpperCase()}`;
  const heading = isFiniteNumber(flight.trueTrack) ? flight.trueTrack : null;
  const verticalRate = aircraftVerticalRate(flight);
  const canEnterFpv =
    isFiniteNumber(flight.longitude) &&
    isFiniteNumber(flight.latitude) &&
    !flight.onGround;

  return (
    <ScrollArea className="h-full" viewportClassName="pb-6">
      <HeroBanner
        photo={photos[0] ?? null}
        loading={photosLoading}
        alt={`${identity} aircraft`}
      />

      <div className="px-6">
        <header className="flex min-h-16 items-center gap-3.5 py-5">
          <AirlineMark callsign={flight.callsign} airline={airline} />
          <div className="min-w-0">
            <h2 className="truncate text-title text-foreground">{identity}</h2>
            <p className="truncate text-small text-muted-foreground">
              {subtitle}
            </p>
            <p className="truncate text-label text-subtle">
              {airframe}
              {isMilitaryAircraft(flight.dbFlags) && (
                <span className="text-warning"> · Military</span>
              )}
            </p>
          </div>
        </header>

        {hasEmergencyStatus(flight.emergencyStatus) && (
          <p className="mb-4 text-small text-danger" role="status">
            Emergency: {flight.emergencyStatus}
          </p>
        )}

        <RouteSummary routeInfo={routeInfo} />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5">
          <Fact label="Altitude" value={formatAltitude(flight.baroAltitude, units)} />
          <Fact label="Speed" value={formatSpeed(flight.velocity, units)} />
          <Fact
            label="Heading"
            value={
              heading === null
                ? "-"
                : `${Math.round(heading)}° ${headingToCardinal(heading)}`
            }
          />
          <Fact
            label="Vertical speed"
            value={formatVerticalSpeed(verticalRate, units)}
          />
        </dl>

        <AircraftDetails
          key={flight.icao24}
          rows={buildAircraftDetailRows(
            flight,
            details,
            units,
            settings.showDebugData,
          )}
        />

        {onToggleFpv && (
          <button
            type="button"
            onClick={() => onToggleFpv(flight.icao24)}
            disabled={!canEnterFpv}
            className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border text-small text-tint transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:text-subtle"
          >
            First person view
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        )}

        <p className="mt-4 text-micro text-subtle">
          {[freshness, sources.join(", ")].filter(Boolean).join(" · ")}
        </p>
      </div>
    </ScrollArea>
  );
}

function AirlineMark({
  callsign,
  airline,
}: {
  callsign: string | null;
  airline: string | null;
}) {
  if (!airline) {
    return (
      <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-card text-subtle">
        <Plane className="size-6" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-white">
      <AirlineLogo
        callsign={callsign}
        airlineName={airline}
        size={40}
        className="rounded-none bg-transparent"
      />
    </span>
  );
}

/**
 * The reported route, or a note while it loads or when none is reported.
 * Every state keeps the same height so the facts below never move.
 */
export function RouteSummary({ routeInfo }: { routeInfo: FlightRouteInfo }) {
  const origin = routeInfo.available ? formatAirportCode(routeInfo.origin) : "";
  const destination = routeInfo.available
    ? formatAirportCode(routeInfo.destination)
    : "";

  return (
    <section aria-label="Reported route" className="border-t border-border py-4">
      <p className="text-label text-subtle">Reported route</p>
      {origin && destination ? (
        <div className="mt-1 grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-3">
          <RouteEndpoint code={origin} place={routeInfo.origin?.municipality ?? ""} />
          <ArrowRight className="size-4 text-subtle" aria-label="to" />
          <RouteEndpoint
            code={destination}
            place={routeInfo.destination?.municipality ?? ""}
            alignEnd
          />
        </div>
      ) : (
        <p className="mt-1 flex h-11 items-center text-small text-subtle">
          {describeMissingRoute(routeInfo)}
        </p>
      )}
    </section>
  );
}

function RouteEndpoint({
  code,
  place,
  alignEnd = false,
}: {
  code: string;
  place: string;
  alignEnd?: boolean;
}) {
  return (
    <div className={alignEnd ? "min-w-0 text-right" : "min-w-0"}>
      <p className="text-value text-foreground">{code}</p>
      {place && <p className="truncate text-label text-subtle">{place}</p>}
    </div>
  );
}

/** A fact with its unit set smaller, as in "31,000 ft". */
function Fact({ label, value }: { label: string; value: string }) {
  const unitStart = value.lastIndexOf(" ");
  const amount = unitStart > 0 ? value.slice(0, unitStart) : value;
  const unit = unitStart > 0 ? value.slice(unitStart + 1) : null;
  return (
    <div className="min-w-0">
      <dt className="text-label text-subtle">{label}</dt>
      <dd className="mt-1 truncate text-value text-foreground">
        {amount}
        {unit && <span className="ml-1 text-label text-subtle">{unit}</span>}
      </dd>
    </div>
  );
}

function AircraftDetails({ rows }: { rows: AircraftDetailRow[] }) {
  return (
    <details className="group border-b border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-small text-foreground marker:content-none">
        Details
        <ChevronDown
          className="size-4 text-subtle transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <dl className="pb-3">
        {rows.map(({ key, label, value }) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 py-1.5 text-small"
          >
            <dt className="text-subtle">{label}</dt>
            <dd className="min-w-0 text-right text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

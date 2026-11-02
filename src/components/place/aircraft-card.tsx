"use client";

import {
  memo,
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Crosshair,
  Link2,
  Plane,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { PRESS_SCALE } from "@/lib/motion";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
import { useSettings } from "@/hooks/use-settings";
import { useRouteInfo, type FlightRouteInfo } from "@/hooks/use-route-info";
import { useMetar } from "@/components/ui/airport-info-card/use-airport-data";
import type { FlightState } from "@/lib/opensky";
import { isFiniteNumber } from "@/lib/opensky-parsing";
import { headingToCardinal } from "@/lib/flight-utils";
import { lookupAirline } from "@/lib/airlines";
import { formatAirportCode } from "@/lib/route-lookup";
import { describeFlightStatus, type FlightStatus } from "@/lib/flight-status";
import { describeNotableWeather } from "@/lib/metar-words";
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
  formatTimeSinceTakeoff,
  isMilitaryAircraft,
} from "@/lib/aircraft-sidebar";
import { writeSelectionLink } from "@/components/flight-tracker-utils";
import { AirlineLogo } from "@/components/ui/airline-logo";
import { HeroBanner } from "@/components/ui/hero-banner";
import { FreshnessLine } from "./freshness-line";

export type AircraftCardProps = {
  flight: FlightState;
  following: boolean;
  onToggleFollow?: (icao24: string) => void;
  onToggleFpv?: (icao24: string) => void;
  onClose?: () => void;
  /** Starts a drag of the surface the card sits in, from its header. */
  onGrab?: (event: ReactPointerEvent) => void;
};

/**
 * The one aircraft card, on the phone's sheet and the desktop's panel. It
 * leads with what the aircraft is doing and where it is going, then the
 * actions, then the numbers; everything else waits further down.
 */
export const AircraftCard = memo(function AircraftCard({
  flight,
  following,
  onToggleFollow,
  onToggleFpv,
  onClose,
  onGrab,
}: AircraftCardProps) {
  const { settings } = useSettings();
  const units = settings.unitSystem;
  const routeInfo = useRouteInfo(flight);
  const airline = lookupAirline(flight.callsign);
  const { photos, aircraft: photoAircraft, loading: photosLoading } =
    useAircraftPhotos(flight.icao24, flight.registration);
  const details = buildAircraftSidebarViewModel(flight, airline, photoAircraft);
  const sources = formatAircraftDataSources(
    flight.provenance.contributingSources,
  );

  const destination = routeInfo.available ? routeInfo.destination : null;
  const { metar } = useMetar(destination?.icao || null);
  const status = describeFlightStatus({
    flight,
    route: routeInfo.available
      ? {
          origin: routeInfo.origin,
          destination: routeInfo.destination,
          mismatch: routeInfo.mismatch,
        }
      : { origin: null, destination: null, mismatch: routeInfo.mismatch },
    weather: destination
      ? describeNotableWeather(formatAirportCode(destination), metar, units)
      : null,
    units,
  });

  const identity = formatAircraftIdentity(flight, details);
  const aircraftName = formatAircraftName(details);
  const subtitle = details.airline ?? aircraftName ?? "Unknown aircraft";
  const heading = isFiniteNumber(flight.trueTrack) ? flight.trueTrack : null;
  const verticalRate = aircraftVerticalRate(flight);
  const hasPosition =
    isFiniteNumber(flight.longitude) && isFiniteNumber(flight.latitude);
  const canEnterFpv = hasPosition && !flight.onGround;
  const statusId = `aircraft-status-${flight.icao24}`;

  return (
    <article
      aria-label={identity}
      aria-describedby={statusId}
      className="pb-6"
    >
      <header
        onPointerDown={onGrab}
        className="flex items-center gap-3 px-5 pt-4"
      >
        <AirlineMark callsign={flight.callsign} airline={airline} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title text-foreground">{identity}</h2>
          <p className="flex min-w-0 gap-2 text-small text-muted-foreground">
            <span className="truncate">{subtitle}</span>
            {isMilitaryAircraft(flight.dbFlags) && (
              <span className="shrink-0 text-warning">Military</span>
            )}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:text-foreground"
            aria-label={`Close ${identity}`}
          >
            <span className="grid size-8 place-items-center rounded-full bg-card">
              <X className="size-4" aria-hidden="true" />
            </span>
          </button>
        )}
      </header>

      <StatusBlock id={statusId} status={status} />

      <RouteBlock
        routeInfo={routeInfo}
        status={status}
        now={flight.provenance.responseTime}
      />

      <div data-sheet-peek className="flex gap-2 px-5 pt-1 pb-4">
        {onToggleFollow && (
          <ActionButton
            primary
            pressed={following}
            onClick={() => onToggleFollow(flight.icao24)}
            disabled={!hasPosition && !following}
            label={following ? "Following" : "Follow"}
            shortcut="F"
          >
            {following ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Crosshair className="size-4" aria-hidden="true" />
            )}
          </ActionButton>
        )}
        {onToggleFpv && (
          <ActionButton
            onClick={() => onToggleFpv(flight.icao24)}
            disabled={!canEnterFpv}
            label="First person"
            shortcut="V"
          >
            <Plane className="size-4 -rotate-45" aria-hidden="true" />
          </ActionButton>
        )}
        <ShareButton icao24={flight.icao24} following={following} />
      </div>

      <dl className="mx-5 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4">
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

      <div className="mt-4 overflow-hidden">
        <HeroBanner
          photo={photos[0] ?? null}
          loading={photosLoading}
          alt={`${identity} aircraft`}
        />
      </div>

      <div className="px-5">
        <AircraftDetails
          key={flight.icao24}
          rows={buildAircraftDetailRows(
            flight,
            details,
            units,
            settings.showDebugData,
          )}
        />

        <div className="mt-4">
          <FreshnessLine provenance={flight.provenance} sources={sources} />
        </div>
      </div>
    </article>
  );
});

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the aircraft is doing, and why it matters when something does. */
export function StatusBlock({
  id,
  status,
}: {
  id?: string;
  status: FlightStatus;
}) {
  const tone =
    status.cause?.tone === "danger"
      ? "text-danger"
      : status.cause?.tone === "warning"
        ? "text-warning"
        : "text-subtle";
  return (
    <section id={id} aria-label="Status" className="px-5 pt-4">
      <p className="text-value text-foreground text-pretty">
        {status.headline}
      </p>
      {status.timing && (
        <p className="text-small text-muted-foreground">
          {upperFirst(status.timing)}
        </p>
      )}
      {status.cause && (
        <p className={`mt-1 text-small ${tone}`} role={status.cause.tone === "danger" ? "status" : undefined}>
          {status.cause.text}
        </p>
      )}
    </section>
  );
}

/**
 * Where the aircraft is coming from and going to, how far along it is, and
 * when it was seen taking off. The time left is in the status line above,
 * so it is not said twice. Every state of the row keeps one height, so
 * nothing below moves when the route arrives.
 *
 * @param now The time the aircraft was last reported, in milliseconds.
 */
export function RouteBlock({
  routeInfo,
  status,
  now,
}: {
  routeInfo: FlightRouteInfo;
  status: Pick<FlightStatus, "progress">;
  now: number;
}) {
  const origin = routeInfo.available ? formatAirportCode(routeInfo.origin) : "";
  const destination = formatAirportCode(routeInfo.destination);
  const departedAt = routeInfo.departedAt;
  const progress = destination ? status.progress : null;

  return (
    <section aria-label="Route" className="px-5 py-4">
      {origin ? (
        <>
          <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-3">
            <RouteEndpoint
              code={origin}
              place={routeInfo.origin?.municipality ?? ""}
            />
            <ArrowRight className="size-4 text-subtle" aria-label="to" />
            {destination ? (
              <RouteEndpoint
                code={destination}
                place={routeInfo.destination?.municipality ?? ""}
                alignEnd
              />
            ) : (
              <p className="min-w-0 truncate text-right text-small text-subtle">
                Not reported
              </p>
            )}
          </div>
          {progress !== null && (
            <div
              className="mt-3 h-1 overflow-hidden rounded-full bg-card"
              role="progressbar"
              aria-label="Share of the route flown"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className="h-full origin-left rounded-full bg-tint transition-transform duration-700"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          )}
          {departedAt !== null && (
            <p className="mt-1.5 truncate text-label text-subtle">
              {formatTimeSinceTakeoff(departedAt, now)}
            </p>
          )}
        </>
      ) : (
        <p className="flex h-11 items-center text-small text-subtle">
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

function AirlineMark({
  callsign,
  airline,
}: {
  callsign: string | null;
  airline: string | null;
}) {
  if (!airline) {
    return (
      <span className="grid size-11 shrink-0 place-items-center rounded-md bg-card text-subtle">
        <Plane className="size-5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white">
      <AirlineLogo
        callsign={callsign}
        airlineName={airline}
        size={32}
        className="rounded-none bg-transparent"
      />
    </span>
  );
}

function ActionButton({
  primary = false,
  pressed,
  disabled = false,
  onClick,
  label,
  shortcut,
  children,
}: {
  primary?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  const on = primary && pressed;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      whileTap={disabled ? undefined : { scale: PRESS_SCALE }}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-small transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        primary ? "flex-1" : ""
      } ${
        on
          ? "bg-tint text-background"
          : "bg-card text-foreground hover:bg-accent"
      }`}
    >
      {children}
      {label}
    </motion.button>
  );
}

/** Copies a link that opens this aircraft, or shares it on a phone. */
function ShareButton({
  icao24,
  following,
}: {
  icao24: string;
  following: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const share = useCallback(async () => {
    const url = new URL(window.location.href);
    writeSelectionLink(url.searchParams, {
      selection: { kind: "aircraft", icao24 },
      follow: following ? icao24 : null,
      fpv: null,
    });
    const link = url.toString();
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (coarse && navigator.share) {
      try {
        await navigator.share({ url: link });
      } catch {
        // Dismissing the share sheet is not an error worth showing.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the address bar has the same link.
    }
  }, [following, icao24]);

  return (
    <motion.button
      type="button"
      onClick={share}
      whileTap={{ scale: PRESS_SCALE }}
      className="grid size-11 shrink-0 place-items-center rounded-full bg-card text-foreground transition-colors hover:bg-accent"
      aria-label={copied ? "Link copied" : "Copy link"}
      title={copied ? "Link copied" : "Copy link"}
    >
      {copied ? (
        <Check className="size-4 text-tint" aria-hidden="true" />
      ) : (
        <Link2 className="size-4" aria-hidden="true" />
      )}
    </motion.button>
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
    <details className="group mt-3 border-y border-border">
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

"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import {
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Gauge,
  Compass,
  Eye,
  X,
  Building2,
  ChevronDown,
  Globe,
  Info,
  Navigation,
  Camera,
  ImageOff,
  Plane,
} from "lucide-react";
import { useAircraftFreshness } from "@/hooks/use-aircraft-freshness";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
import { useRouteInfo, type FlightRouteInfo } from "@/hooks/use-route-info";
import {
  OnGroundBadge,
  PositionSourceBadge,
} from "@/components/ui/flight-badges";
import { useSettings } from "@/hooks/use-settings";
import type { FlightState } from "@/lib/opensky";
import {
  type AircraftDetailKey,
  type AircraftDetailRow,
  aircraftVerticalRate,
  buildAircraftDetailRows,
  buildAircraftSidebarViewModel,
  describeMissingRoute,
  formatAircraftDataSources,
  formatAircraftIdentity,
  formatAircraftName,
  formatAircraftPosition,
  hasEmergencyStatus,
  isMilitaryAircraft,
} from "@/lib/aircraft-sidebar";
import { headingToCardinal } from "@/lib/flight-utils";
import { isFiniteNumber } from "@/lib/opensky-parsing";
import { formatAirportCode } from "@/lib/route-lookup";
import { lookupAirline, parseFlightNumber } from "@/lib/airlines";
import { airlineLogoCandidates } from "@/lib/airline-logos";
import {
  loadedAirlineLogoUrls,
  trackAirlineLogoLoaded,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/lib/logo-cache";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";
import {
  formatAltitude,
  formatSpeed,
  formatVerticalSpeedValue,
} from "@/lib/unit-formatters";
import { cn } from "@/lib/utils";

type MobileFlightToastProps = {
  flight: FlightState;
  onClose: () => void;
  onToggleFpv?: (icao24: string) => void;
  /** Called when a press lands on the photo or header, to drag the card. */
  onGrab?: (event: React.PointerEvent) => void;
};

const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);

/** Details the card already shows in its own rows above the list. */
const SHOWN_ABOVE_DETAILS = new Set<AircraftDetailKey>([
  "country",
  "position",
  "squawk",
]);

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

type PhotoCarouselHeroProps = {
  photos: NormalizedPhoto[];
  loading: boolean;
};

function PhotoCarouselHero({ photos, loading }: PhotoCarouselHeroProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideLoadState, setSlideLoadState] = useState<
    Record<number, "loaded" | "error">
  >({});
  const [mountedSlides, setMountedSlides] = useState<Set<number>>(
    () => new Set([0]),
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0 || photos.length === 0) return;

    const idx = Math.max(
      0,
      Math.min(photos.length - 1, Math.round(el.scrollLeft / el.clientWidth)),
    );

    setActiveSlide(idx);
    setMountedSlides((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }, [photos.length]);

  const handleSlideLoad = useCallback((index: number) => {
    setSlideLoadState((current) => ({ ...current, [index]: "loaded" }));
  }, []);

  const handleSlideError = useCallback((index: number) => {
    setSlideLoadState((current) => ({ ...current, [index]: "error" }));
  }, []);

  const hasPhotos = photos.length > 0;
  const showPhotos = !loading && hasPhotos;

  return (
    <div className="relative h-48 w-full overflow-hidden bg-card">
      {!loading && !hasPhotos && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-subtle">
          <ImageOff className="h-4 w-4" />
          <span className="text-micro">No photo</span>
        </div>
      )}

      {showPhotos && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // Vertical swipes here drag the card; sideways ones page photos.
          className="flex h-full touch-pan-x snap-x snap-mandatory overflow-x-auto scrollbar-none"
        >
          {photos.map((photo, i) => (
            <div
              key={photo.id}
              className="relative h-full w-full shrink-0 snap-center"
            >
              {slideLoadState[i] === "error" ? (
                <div className="flex h-full w-full items-center justify-center text-subtle">
                  <ImageOff className="h-5 w-5" />
                </div>
              ) : mountedSlides.has(i) ? (
                <Image
                  src={photo.url}
                  alt={`Aircraft photo ${i + 1}`}
                  fill
                  sizes="100vw"
                  unoptimized
                  onLoad={() => handleSlideLoad(i)}
                  onError={() => handleSlideError(i)}
                  className={`object-cover transition-opacity duration-300 ${
                    slideLoadState[i] === "loaded" ? "opacity-100" : "opacity-0"
                  }`}
                  draggable={false}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {showPhotos && photos[activeSlide]?.photographer && (
        <span className="absolute bottom-1.5 right-2 z-10 flex items-center gap-0.5 rounded-full bg-background px-1.5 py-0.5 text-micro text-muted-foreground">
          <Camera className="h-2 w-2" />
          {photos[activeSlide].photographer}
        </span>
      )}

      {showPhotos && photos.length > 1 && (
        <PhotoDots count={photos.length} active={activeSlide} />
      )}

      {showPhotos && photos.length > 1 && (
        <span className="absolute top-1.5 right-2 z-10 rounded-full bg-background px-1.5 py-0.5 text-micro text-muted-foreground">
          {activeSlide + 1}/{photos.length}
        </span>
      )}
    </div>
  );
}

/** The most dots shown under the photos; more slide along with the photo. */
const MAX_PHOTO_DOTS = 5;

/**
 * Where the photo carousel is, as a short row of dots that slides with the
 * active photo. Dots at an edge with more photos beyond it are smaller.
 */
function PhotoDots({ count, active }: { count: number; active: number }) {
  const shown = Math.min(count, MAX_PHOTO_DOTS);
  const first = Math.min(
    Math.max(0, active - Math.floor(shown / 2)),
    count - shown,
  );

  return (
    <div
      aria-hidden="true"
      className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1"
    >
      {Array.from({ length: shown }, (_, offset) => {
        const index = first + offset;
        const moreBeyond =
          (offset === 0 && index > 0) ||
          (offset === shown - 1 && index < count - 1);
        return (
          <span
            key={index}
            className={`rounded-full transition-colors duration-200 ${
              moreBeyond ? "size-0.75" : "size-1"
            } ${index === active ? "bg-subtle" : "bg-border"}`}
          />
        );
      })}
    </div>
  );
}

export function MobileFlightToast({
  flight,
  onClose,
  onToggleFpv,
  onGrab,
}: MobileFlightToastProps) {
  const { settings } = useSettings();
  const airline = lookupAirline(flight.callsign);
  const flightNum = airline ? parseFlightNumber(flight.callsign) : null;

  // Aircraft photos and details.
  const {
    photos,
    aircraft: aircraftDetails,
    loading: photosLoading,
  } = useAircraftPhotos(flight.icao24, flight.registration);
  const photoKey = photos.map((p) => p.id).join(",");
  const details = buildAircraftSidebarViewModel(flight, airline, aircraftDetails);
  const routeInfo = useRouteInfo(flight);
  const freshness = useAircraftFreshness(flight.provenance);
  const sources = formatAircraftDataSources(
    flight.provenance.contributingSources,
  );
  const identity = formatAircraftIdentity(flight, details);
  // Always filled, so registry details arriving later do not add a row.
  const airframeLine =
    [formatAircraftName(details), details.registration]
      .filter(Boolean)
      .join(" · ") || `ICAO ${flight.icao24.toUpperCase()}`;
  const country = [details.registrationCountryFlag, details.registrationCountry]
    .filter(Boolean)
    .join(" ");
  const heading = isFiniteNumber(flight.trueTrack) ? flight.trueTrack : null;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const position =
    isFiniteNumber(flight.latitude) && isFiniteNumber(flight.longitude)
      ? formatAircraftPosition(flight.latitude, flight.longitude)
      : null;
  const detailRows = buildAircraftDetailRows(
    flight,
    details,
    settings.unitSystem,
    settings.showDebugData,
  ).filter((row) => !SHOWN_ABOVE_DETAILS.has(row.key));
  const canEnterFpv =
    flight.longitude != null && flight.latitude != null && !flight.onGround;

  // Airline logo fallback chain.
  const logoCandidates = airlineLogoCandidates(airline, flight.callsign);
  const [logoIndexByAirline, setLogoIndexByAirline] = useState<
    Record<string, number>
  >({});
  const [logoLoadedByKey, setLogoLoadedByKey] = useState<
    Record<string, boolean>
  >({});

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


  return (
    // The photo and header stay put while the rest scrolls, so the card can
    // always be swiped down from them or closed, and the map shows above it.
    <div className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lift">
      <div className="shrink-0 touch-none" onPointerDown={onGrab}>
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-2 z-20 h-1 w-9 -translate-x-1/2 rounded-full bg-border"
        />
        <PhotoCarouselHero
          key={photoKey}
          photos={photos}
          loading={photosLoading}
        />

        <div className="px-4 pb-4 pt-3.5">
          {/* Header row: logo + callsign + close */}
          <div className="flex items-center gap-3">
            {/* Airline logo */}
            <div className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-card">
              {showLogo ? (
                <span className="relative grid size-full place-items-center bg-white p-2.5">
                  <Image
                    src={logoUrl ?? undefined}
                    alt={airline ? `${airline} logo` : "Airline logo"}
                    width={40}
                    height={40}
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
                <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-background text-subtle">
                  <Plane className="h-6 w-6" aria-hidden="true" />
                </span>
              )}
            </div>

            {/* Callsign + identifiers */}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="truncate text-value font-medium leading-tight text-foreground">
                  {identity}
                </p>
                <PositionSourceBadge source={flight.positionSource} />
                <OnGroundBadge onGround={flight.onGround} />
              </div>
              <p className="mt-1 truncate text-caption text-subtle">
                {flight.icao24}
                {flightNum ? ` · #${flightNum}` : ""}
              </p>
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors active:bg-accent"
              aria-label="Close aircraft details"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="px-4 pb-4">
          {/* Airline / model */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {airline && (
              <MobileGroupedRow icon={<Building2 className="h-3.5 w-3.5" />}>
                <p className="truncate text-small font-medium text-muted-foreground">
                  Airline: {airline}
                </p>
              </MobileGroupedRow>
            )}
            <MobileGroupedRow
              icon={<Plane className="h-3.5 w-3.5" />}
              divided={Boolean(airline)}
            >
              <p className="truncate text-small text-muted-foreground">
                {airframeLine}
              </p>
            </MobileGroupedRow>
          </div>
          {/* Military / Emergency indicators */}
          {(isMilitaryAircraft(flight.dbFlags) ||
            hasEmergencyStatus(flight.emergencyStatus)) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isMilitaryAircraft(flight.dbFlags) && (
                <span className="text-label text-warning">Military</span>
              )}
              {hasEmergencyStatus(flight.emergencyStatus) && (
                <span className="text-label text-danger" role="status">
                  Emergency: {flight.emergencyStatus}
                </span>
              )}
            </div>
          )}
        </div>

        <MobileRoute routeInfo={routeInfo} />

        {/* Metrics 4-column grid */}
        <div className="mx-4 mb-4 grid grid-cols-4 gap-1.5 rounded-lg border border-border bg-card p-1.5">
          <MiniMetric
            icon={<ArrowUp className="h-2.5 w-2.5" />}
            label="ALT"
            value={formatAltitude(flight.baroAltitude, settings.unitSystem)}
          />
          <MiniMetric
            icon={<Gauge className="h-2.5 w-2.5" />}
            label="SPD"
            value={formatSpeed(flight.velocity, settings.unitSystem)}
          />
          <MiniMetric
            icon={<Compass className="h-2.5 w-2.5" />}
            label="HDG"
            value={
              heading !== null && Number.isFinite(heading)
                ? `${Math.round(heading)}° ${cardinal}`
                : "-"
            }
          />
          <MiniMetric
            icon={<ArrowDown className="h-2.5 w-2.5" />}
            label="V/S"
            value={formatVerticalSpeedValue(
              aircraftVerticalRate(flight),
              settings.unitSystem,
            ).text}
          />
        </div>

        {/* Where it is registered, where it is heading, and its squawk */}
        {(country || cardinal || position || flight.squawk) && (
          <div className="mx-4 mb-4 overflow-hidden rounded-lg border border-border bg-card">
            {country && (
              <MobileGroupedRow icon={<Globe className="h-3.5 w-3.5" />}>
                <p className="truncate text-small text-muted-foreground">
                  {country}
                </p>
              </MobileGroupedRow>
            )}

            {(cardinal || position) && (
              <MobileGroupedRow
                icon={
                  <Navigation
                    className="h-3.5 w-3.5"
                    style={{
                      transform:
                        heading !== null ? `rotate(${heading}deg)` : undefined,
                    }}
                  />
                }
                divided={Boolean(country)}
              >
                <p className="truncate text-small text-muted-foreground">
                  {cardinal && `Heading ${cardinal}`}
                  {position && (
                    <span className="text-subtle">
                      {cardinal ? " · " : ""}
                      {position}
                    </span>
                  )}
                </p>
              </MobileGroupedRow>
            )}

            {flight.squawk && (
              <MobileGroupedRow
                icon={
                  <span
                    className={`text-micro font-medium leading-none ${
                      isEmergencySquawk(flight.squawk)
                        ? "text-danger"
                        : "text-subtle"
                    }`}
                  >
                    SQ
                  </span>
                }
                divided={Boolean(country || cardinal || position)}
              >
                <p
                  className={`font-mono text-small ${
                    isEmergencySquawk(flight.squawk)
                      ? "text-danger"
                      : "text-muted-foreground"
                  }`}
                >
                  {flight.squawk}
                  {isEmergencySquawk(flight.squawk) && (
                    <span className="ml-2 font-sans text-label text-danger">
                      {squawkLabel(flight.squawk)}
                    </span>
                  )}
                </p>
              </MobileGroupedRow>
            )}
          </div>
        )}

        {detailRows.length > 0 && (
          <MobileDetails key={flight.icao24} rows={detailRows} />
        )}

        {/* FPV button */}
        {onToggleFpv && (
          <div className="mx-4 mb-4 overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => onToggleFpv(flight.icao24)}
              disabled={!canEnterFpv}
              className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
            >
              <MobileIconCell>
                <Eye className="h-3.5 w-3.5" />
              </MobileIconCell>
              <span className="min-w-0 flex-1 text-small font-medium text-muted-foreground">
                First person view
              </span>
            </button>
          </div>
        )}

        <p className="px-4 pb-4 text-micro text-subtle">
          {[freshness, sources.join(", ")].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

/**
 * The reported route, or a note while it loads or when none is reported.
 * Every state keeps the same height so the card never jumps.
 */
function MobileRoute({ routeInfo }: { routeInfo: FlightRouteInfo }) {
  const origin = routeInfo.available ? formatAirportCode(routeInfo.origin) : "";
  const destination = routeInfo.available
    ? formatAirportCode(routeInfo.destination)
    : "";

  return (
    <section
      aria-label="Reported route"
      className="mx-4 mb-4 rounded-lg border border-border bg-card px-3.5 py-2.5"
    >
      <p className="text-micro text-subtle">Reported route</p>
      {origin && destination ? (
        <div className="mt-1 grid h-10 grid-cols-[1fr_auto_1fr] items-center gap-3">
          <MobileRouteEnd
            code={origin}
            place={routeInfo.origin?.municipality ?? ""}
          />
          <ArrowRight className="h-3.5 w-3.5 text-subtle" aria-label="to" />
          <MobileRouteEnd
            code={destination}
            place={routeInfo.destination?.municipality ?? ""}
            alignEnd
          />
        </div>
      ) : (
        <p className="mt-1 flex h-10 items-center text-small text-muted-foreground">
          {describeMissingRoute(routeInfo)}
        </p>
      )}
    </section>
  );
}

function MobileRouteEnd({
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
      <p className="text-value leading-tight text-foreground">{code}</p>
      {place && <p className="truncate text-micro text-subtle">{place}</p>}
    </div>
  );
}

/** The rest of the aircraft's details, folded away until asked for. */
function MobileDetails({ rows }: { rows: AircraftDetailRow[] }) {
  return (
    <details className="group mx-4 mb-4 overflow-hidden rounded-lg border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 marker:content-none active:bg-accent [&::-webkit-details-marker]:hidden">
        <MobileIconCell>
          <Info className="h-3.5 w-3.5" />
        </MobileIconCell>
        <span className="min-w-0 flex-1 text-small font-medium text-muted-foreground">
          Details
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 text-subtle transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <dl className="border-t border-border px-3.5 py-2">
        {rows.map(({ key, label, value }) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 py-1.5 text-small"
          >
            <dt className="text-subtle">{label}</dt>
            <dd className="min-w-0 text-right text-muted-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function MobileIconCell({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-subtle">
      {children}
    </span>
  );
}

function MobileGroupedRow({
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
        divided && "border-t border-border",
      )}
    >
      <MobileIconCell>{icon}</MobileIconCell>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MiniMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-md border border-border bg-background px-1.5 py-2">
      <div className="flex items-center gap-1 text-subtle">
        {icon}
        <span className="text-micro">
          {label}
        </span>
      </div>
      <p className="max-w-full text-center text-caption leading-tight text-foreground [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}

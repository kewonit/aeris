"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import {
  ArrowUp,
  ArrowDown,
  Gauge,
  Compass,
  Eye,
  X,
  Building2,
  Globe,
  Navigation,
  Camera,
  ImageOff,
  Plane,
} from "lucide-react";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
import {
  OnGroundBadge,
  PositionSourceBadge,
} from "@/components/ui/flight-badges";
import { useSettings } from "@/hooks/use-settings";
import type { FlightState } from "@/lib/opensky";
import {
  buildAircraftSidebarViewModel,
  hasEmergencyStatus,
  isMilitaryAircraft,
} from "@/lib/aircraft-sidebar";
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
};

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
          className="flex h-full snap-x snap-mandatory overflow-x-auto scrollbar-none"
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
        <div className="absolute bottom-1.5 left-1/2 z-10 flex -translate-x-1/2 gap-1">
          {photos.slice(0, 10).map((_, i) => (
            <span
              key={i}
              className={`h-1 w-1 rounded-full transition-colors duration-200 ${
                i === activeSlide ? "bg-subtle" : "bg-border"
              }`}
            />
          ))}
          {photos.length > 10 && (
            <span className="text-micro leading-none text-subtle">
              +{photos.length - 10}
            </span>
          )}
        </div>
      )}

      {showPhotos && photos.length > 1 && (
        <span className="absolute top-1.5 right-2 z-10 rounded-full bg-background px-1.5 py-0.5 text-micro text-muted-foreground">
          {activeSlide + 1}/{photos.length}
        </span>
      )}
    </div>
  );
}

export function MobileFlightToast({
  flight,
  onClose,
  onToggleFpv,
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
  const airframeLine = [
    details.registration,
    details.model ?? details.typeCode,
    details.manufacturer,
  ]
    .filter(Boolean)
    .join(" · ");
  const heading = flight.trueTrack;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
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
    <div className="scrollbar-none relative max-h-[calc(100dvh-1rem)] w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-background shadow-lift overscroll-contain">
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-2 z-20 h-1 w-9 -translate-x-1/2 rounded-full bg-border"
      />
      <PhotoCarouselHero
        key={photoKey}
        photos={photos}
        loading={photosLoading}
      />

      <div className="p-4 pt-3.5">
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
                {formatCallsign(flight.callsign)}
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
        {/* Airline / model */}
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
          {airline && (
            <MobileGroupedRow icon={<Building2 className="h-3.5 w-3.5" />}>
              <p className="truncate text-small font-medium text-muted-foreground">
                Airline: {airline}
              </p>
            </MobileGroupedRow>
          )}
          {airframeLine && (
            <MobileGroupedRow
              icon={<Plane className="h-3.5 w-3.5" />}
              divided={Boolean(airline)}
            >
              <p className="truncate text-small text-muted-foreground">
                {airframeLine}
              </p>
            </MobileGroupedRow>
          )}
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
            flight.verticalRate,
            settings.unitSystem,
          ).text}
        />
      </div>

      {/* Info section: origin, heading + coords, squawk */}
      <div className="mx-4 mb-4 overflow-hidden rounded-lg border border-border bg-card">
        {/* Registration country */}
        {flight.registrationCountry && (
          <MobileGroupedRow icon={<Globe className="h-3.5 w-3.5" />}>
            <p className="text-small text-muted-foreground">
              Registration country: {flight.registrationCountry}
            </p>
          </MobileGroupedRow>
        )}

        {/* Heading direction + coordinates */}
        {cardinal && (
          <MobileGroupedRow
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
            divided={Boolean(flight.registrationCountry)}
          >
            <p className="text-small text-muted-foreground">
              Heading {cardinal}
              {flight.latitude !== null &&
                flight.longitude !== null &&
                Number.isFinite(flight.latitude) &&
                Number.isFinite(flight.longitude) && (
                  <span className="text-subtle">
                    {" "}
                    · {Math.abs(flight.latitude).toFixed(2)}°
                    {flight.latitude >= 0 ? "N" : "S"},{" "}
                    {Math.abs(flight.longitude).toFixed(2)}°
                    {flight.longitude >= 0 ? "E" : "W"}
                  </span>
                )}
            </p>
          </MobileGroupedRow>
        )}

        {/* Squawk code */}
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
            divided
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
    </div>
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

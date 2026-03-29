"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
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
  Shield,
  AlertTriangle,
} from "lucide-react";
import { useAircraftPhotos } from "@/hooks/use-aircraft-photos";
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
  trackAirlineLogoLoaded,
  markAirlineLogoFailed,
  wasAirlineLogoRecentlyFailed,
} from "@/lib/logo-cache";

type MobileFlightToastProps = {
  flight: FlightState;
  onClose: () => void;
  onToggleFpv?: (icao24: string) => void;
  isFpvActive?: boolean;
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

function isMilitary(dbFlags?: number | null): boolean {
  return ((dbFlags ?? 0) & 1) !== 0;
}

function isEmergencyStatus(status?: string | null): boolean {
  return !!status && status !== "none";
}

export function MobileFlightToast({
  flight,
  onClose,
  onToggleFpv,
  isFpvActive = false,
}: MobileFlightToastProps) {
  const airline = lookupAirline(flight.callsign);
  const flightNum = parseFlightNumber(flight.callsign);
  const company = airline ?? `${flight.originCountry} operator`;
  const model = aircraftTypeHint(flight.category);
  const heading = flight.trueTrack;
  const cardinal = heading !== null ? headingToCardinal(heading) : null;
  const canEnterFpv =
    flight.longitude != null && flight.latitude != null && !flight.onGround;

  // â”€â”€ Airline logo with fallback chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const logoCandidates = airlineLogoCandidates(airline, flight.callsign);
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

  // â”€â”€ Aircraft photos & details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const {
    photos,
    aircraft: aircraftDetails,
    loading: photosLoading,
  } = useAircraftPhotos(flight.icao24, flight.registration);

  // â”€â”€ Photo carousel state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideLoadState, setSlideLoadState] = useState<
    Record<number, "loaded" | "error">
  >({});
  // Progressive loading: only mount <img> for slides the user has reached
  const [mountedSlides, setMountedSlides] = useState<Set<number>>(
    () => new Set([0]),
  );

  // Reset carousel when photos change (new aircraft)
  const photoKey = photos.map((p) => p.id).join(",");
  useEffect(() => {
    setActiveSlide(0);
    setSlideLoadState({});
    setMountedSlides(new Set([0]));
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [photoKey]);

  // When the active slide changes, mount that slide's image
  useEffect(() => {
    setMountedSlides((prev) => {
      if (prev.has(activeSlide)) return prev;
      const next = new Set(prev);
      next.add(activeSlide);
      return next;
    });
  }, [activeSlide]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveSlide(idx);
  }, []);

  const handleSlideLoad = useCallback((index: number) => {
    setSlideLoadState((s) => ({ ...s, [index]: "loaded" }));
  }, []);

  const handleSlideError = useCallback((index: number) => {
    setSlideLoadState((s) => ({ ...s, [index]: "error" }));
  }, []);

  const hasPhotos = photos.length > 0;
  const showPhotos = !photosLoading && hasPhotos;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-foreground/8 bg-background/80 shadow-2xl shadow-background/50 backdrop-blur-2xl">
      {/* Photo carousel / hero banner */}
      <div className="relative h-36 w-full overflow-hidden bg-foreground/5">
        {/* Skeleton while loading */}
        {photosLoading && !hasPhotos && (
          <span
            aria-hidden
            className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/5 via-foreground/8 to-foreground/5"
          />
        )}

        {/* No image placeholder */}
        {!photosLoading && !hasPhotos && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-foreground/15">
            <ImageOff className="h-4 w-4" />
            <span className="text-[9px] font-medium">No photo</span>
          </div>
        )}

        {/* Swipeable photo slider */}
        {showPhotos && (
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex h-full snap-x snap-mandatory overflow-x-auto scrollbar-none"
            style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none" }}
          >
            {photos.map((photo, i) => (
              <div
                key={photo.id}
                className="relative h-full w-full shrink-0 snap-center"
              >
                {/* Show skeleton until this slide's image is loaded */}
                {slideLoadState[i] !== "loaded" &&
                  slideLoadState[i] !== "error" && (
                    <span
                      aria-hidden
                      className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/5 via-foreground/8 to-foreground/5"
                    />
                  )}
                {slideLoadState[i] === "error" ? (
                  <div className="flex h-full w-full items-center justify-center text-foreground/15">
                    <ImageOff className="h-5 w-5" />
                  </div>
                ) : mountedSlides.has(i) ? (
                  <img
                    src={photo.url}
                    alt={`Aircraft photo ${i + 1}`}
                    decoding="async"
                    onLoad={() => handleSlideLoad(i)}
                    onError={() => handleSlideError(i)}
                    className={`h-full w-full object-cover transition-opacity duration-300 ${
                      slideLoadState[i] === "loaded"
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                    draggable={false}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Gradient overlay */}
        {showPhotos && (
          <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-black/5 to-transparent" />
        )}

        {/* Photographer attribution */}
        {showPhotos && photos[activeSlide]?.photographer && (
          <span className="absolute bottom-1.5 right-2 z-10 flex items-center gap-0.5 rounded-full bg-background/45 px-1.5 py-0.5 text-[8px] font-medium text-foreground/55 backdrop-blur-sm">
            <Camera className="h-2 w-2" />
            {photos[activeSlide].photographer}
          </span>
        )}

        {/* Dot indicators */}
        {showPhotos && photos.length > 1 && (
          <div className="absolute bottom-1.5 left-1/2 z-10 flex -translate-x-1/2 gap-1">
            {photos.slice(0, 10).map((_, i) => (
              <span
                key={i}
                className={`h-1 w-1 rounded-full transition-colors duration-200 ${
                  i === activeSlide ? "bg-foreground/80" : "bg-foreground/30"
                }`}
              />
            ))}
            {photos.length > 10 && (
              <span className="text-[7px] leading-none text-foreground/30">
                +{photos.length - 10}
              </span>
            )}
          </div>
        )}

        {/* Slide counter */}
        {showPhotos && photos.length > 1 && (
          <span className="absolute top-1.5 right-2 z-10 rounded-full bg-background/45 px-1.5 py-0.5 text-[8px] font-semibold tabular-nums text-foreground/60 backdrop-blur-sm">
            {activeSlide + 1}/{photos.length}
          </span>
        )}
      </div>

      <div className="p-3.5 pt-3">
        {/* Header row: logo + callsign + close */}
        <div className="flex items-center gap-3">
          {/* Airline logo */}
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-foreground/14 bg-foreground/10 shadow-md shadow-background/25">
            {showLogo ? (
              <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-white/95 p-2 shadow-sm">
                {!logoLoaded && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 animate-pulse bg-linear-to-br from-white/85 via-neutral-200/65 to-white/80"
                  />
                )}
                <Image
                  src={logoUrl ?? undefined}
                  alt={company ? `${company} logo` : "Airline logo"}
                  width={40}
                  height={40}
                  className={`relative h-8 w-8 object-contain transition-opacity duration-200 ${
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
              <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-white/95 p-2 shadow-sm">
                {genericLogoFailed ? (
                  <span className="text-[16px] font-semibold text-background/25">
                    â€”
                  </span>
                ) : (
                  <Image
                    src={genericLogoUrl}
                    alt="Generic airline logo"
                    width={40}
                    height={40}
                    className="h-8 w-8 object-contain grayscale opacity-80"
                    unoptimized
                    onError={() => setGenericLogoFailed(true)}
                  />
                )}
              </span>
            )}
          </div>

          {/* Callsign + identifiers */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight text-foreground">
              {formatCallsign(flight.callsign)}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-medium tracking-widest text-foreground/30 uppercase">
              {flight.icao24}
              {flightNum ? ` Â· #${flightNum}` : ""}
            </p>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/5 transition-colors active:bg-foreground/10"
            aria-label="Close flight details"
          >
            <X className="h-3.5 w-3.5 text-foreground/40" />
          </button>
        </div>
        {/* Airline / model */}
        {company && (
          <div className="mt-2 flex items-center gap-1.5">
            <Building2 className="h-3 w-3 shrink-0 text-foreground/20" />
            <p className="truncate text-[11px] font-medium text-foreground/45">
              {company}
              {model ? (
                <span className="text-foreground/25"> Â· {model}</span>
              ) : null}
            </p>
          </div>
        )}
        {/* Aircraft details (registration, type, owner) */}
        {aircraftDetails &&
          (aircraftDetails.registration ||
            aircraftDetails.type ||
            aircraftDetails.typeCode ||
            aircraftDetails.owner) && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Plane className="h-3 w-3 shrink-0 text-foreground/20" />
              <p className="truncate text-[11px] text-foreground/35">
                {[
                  aircraftDetails.registration,
                  aircraftDetails.type ?? aircraftDetails.typeCode,
                  aircraftDetails.owner,
                ]
                  .filter(Boolean)
                  .join(" Â· ")}
              </p>
            </div>
          )}
        {/* Military / Emergency badges */}
        {(isMilitary(flight.dbFlags) ||
          isEmergencyStatus(flight.emergencyStatus)) && (
          <div className="mt-2 flex items-center gap-1.5 px-0">
            {isMilitary(flight.dbFlags) && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-400 uppercase ring-1 ring-amber-400/20">
                <Shield className="h-2.5 w-2.5" />
                MIL
              </span>
            )}
            {isEmergencyStatus(flight.emergencyStatus) && (
              <span className="inline-flex animate-pulse items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-red-400 uppercase ring-1 ring-red-400/25">
                <AlertTriangle className="h-2.5 w-2.5" />
                {flight.emergencyStatus?.toUpperCase()}
              </span>
            )}
          </div>
        )}{" "}
      </div>

      {/* Metrics 4-column grid */}
      <div className="grid grid-cols-4 gap-px border-t border-foreground/5 bg-foreground/2">
        <MiniMetric
          icon={<ArrowUp className="h-2.5 w-2.5" />}
          label="ALT"
          value={metersToFeet(flight.baroAltitude)}
        />
        <MiniMetric
          icon={<Gauge className="h-2.5 w-2.5" />}
          label="SPD"
          value={msToKnots(flight.velocity)}
        />
        <MiniMetric
          icon={<Compass className="h-2.5 w-2.5" />}
          label="HDG"
          value={
            heading !== null && Number.isFinite(heading)
              ? `${Math.round(heading)}Â° ${cardinal}`
              : "â€”"
          }
        />
        <MiniMetric
          icon={<ArrowDown className="h-2.5 w-2.5" />}
          label="V/S"
          value={
            flight.verticalRate !== null && Number.isFinite(flight.verticalRate)
              ? `${flight.verticalRate > 0 ? "+" : ""}${Math.round(flight.verticalRate)}`
              : "â€”"
          }
        />
      </div>

      {/* Info section: origin, heading + coords, squawk */}
      <div className="flex flex-col gap-1.5 border-t border-foreground/5 px-3.5 py-2.5">
        {/* Origin country */}
        <div className="flex items-center gap-1.5">
          <Globe className="h-3 w-3 text-foreground/25" />
          <p className="text-[11px] text-foreground/40">
            {flight.originCountry}
          </p>
        </div>

        {/* Heading direction + coordinates */}
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
              Heading {cardinal}
              {flight.latitude !== null &&
                flight.longitude !== null &&
                Number.isFinite(flight.latitude) &&
                Number.isFinite(flight.longitude) && (
                  <span className="text-foreground/20">
                    {" "}
                    Â· {Math.abs(flight.latitude).toFixed(2)}Â°
                    {flight.latitude >= 0 ? "N" : "S"},{" "}
                    {Math.abs(flight.longitude).toFixed(2)}Â°
                    {flight.longitude >= 0 ? "E" : "W"}
                  </span>
                )}
            </p>
          </div>
        )}

        {/* Squawk code */}
        {flight.squawk && (
          <div className="flex items-center gap-1.5">
            <span
              className={`h-3 w-3 text-center text-[8px] font-bold leading-3 ${
                isEmergencySquawk(flight.squawk)
                  ? "text-red-400"
                  : "text-foreground/25"
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
                <span className="ml-1.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-red-400 uppercase">
                  {squawkLabel(flight.squawk)}
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* FPV button */}
      {onToggleFpv && (
        <div className="border-t border-foreground/5">
          <button
            type="button"
            onClick={() =>
              (isFpvActive || canEnterFpv) && onToggleFpv(flight.icao24)
            }
            disabled={!isFpvActive && !canEnterFpv}
            className={`flex w-full items-center justify-center gap-1.5 py-2.5 transition-colors active:bg-foreground/5 ${
              !isFpvActive && !canEnterFpv
                ? "cursor-not-allowed opacity-30"
                : ""
            }`}
            aria-label={
              isFpvActive ? "Exit first person view" : "Enter first person view"
            }
          >
            <Eye
              className={`h-3 w-3 ${isFpvActive ? "text-emerald-400" : "text-foreground/30"}`}
            />
            <span
              className={`text-[10px] font-semibold tracking-wider uppercase ${
                isFpvActive ? "text-emerald-400/70" : "text-foreground/35"
              }`}
            >
              {isFpvActive ? "Exit FPV" : "First Person View"}
            </span>
          </button>
        </div>
      )}
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
    <div className="flex flex-col items-center gap-0.5 py-2.5">
      <div className="flex items-center gap-1 text-foreground/20">
        {icon}
        <span className="text-[8px] font-bold tracking-widest uppercase">
          {label}
        </span>
      </div>
      <p className="text-[12px] font-semibold tabular-nums text-foreground/85">
        {value}
      </p>
    </div>
  );
}

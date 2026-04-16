"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Wind,
  Eye,
  Thermometer,
  Gauge,
  Cloud,
  Radio,
  MapPin,
  Loader2,
} from "lucide-react";
import type { Airport } from "@/lib/airports";
import { findNearbyAtcFeeds, iataToIcao } from "@/lib/atc-lookup";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettings } from "@/hooks/use-settings";
import {
  formatCloudBaseHundredsFeet,
  formatPressureHpa,
  formatTemperatureC,
  formatVisibility,
  formatWindFromKnots,
} from "@/lib/unit-formatters";

type MetarData = {
  rawOb?: string;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
  visib?: number | string;
  altim?: number;
  clouds?: { cover: string; base?: number }[];
  fltcat?: string;
  name?: string;
};

type AirportInfoCardProps = {
  airport: Airport | null;
  onClose: () => void;
};

function decodeFltCat(cat: string | undefined): {
  label: string;
  color: string;
  dotColor: string;
} {
  switch (cat?.toUpperCase()) {
    case "VFR":
      return {
        label: "VFR",
        color: "text-emerald-400",
        dotColor: "bg-emerald-400",
      };
    case "MVFR":
      return { label: "MVFR", color: "text-blue-400", dotColor: "bg-blue-400" };
    case "IFR":
      return { label: "IFR", color: "text-red-400", dotColor: "bg-red-400" };
    case "LIFR":
      return {
        label: "LIFR",
        color: "text-purple-400",
        dotColor: "bg-purple-400",
      };
    default:
      return {
        label: "—",
        color: "text-foreground/40",
        dotColor: "bg-foreground/20",
      };
  }
}

function cloudCoverLabel(cover: string): string {
  switch (cover.toUpperCase()) {
    case "SKC":
    case "CLR":
    case "NCD":
      return "Clear";
    case "FEW":
      return "Few";
    case "SCT":
      return "Scattered";
    case "BKN":
      return "Broken";
    case "OVC":
      return "Overcast";
    case "OVX":
      return "Obscured";
    default:
      return cover;
  }
}

// ── Client-side METAR cache (10 min TTL) ───────────────────────────────
const METAR_CACHE_TTL_MS = 10 * 60 * 1000;
const metarCache = new Map<string, { data: MetarData; fetchedAt: number }>();

export function AirportInfoCard({ airport, onClose }: AirportInfoCardProps) {
  const { settings } = useSettings();
  const [metar, setMetar] = useState<MetarData | null>(null);
  const [metarLoading, setMetarLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMetar = useCallback(async (icao: string) => {
    // Check client-side cache first
    const cached = metarCache.get(icao);
    if (cached && Date.now() - cached.fetchedAt < METAR_CACHE_TTL_MS) {
      setMetar(cached.data);
      setMetarLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMetarLoading(true);
    // Show stale cached data while re-fetching instead of blank
    if (cached) setMetar(cached.data);
    else setMetar(null);

    try {
      const res = await fetch(
        `/api/weather/metar?icao=${encodeURIComponent(icao)}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (controller.signal.aborted) return;

      // NOAA returns an array of METAR observations
      const obs = Array.isArray(data) ? data[0] : data;
      if (obs) {
        metarCache.set(icao, { data: obs, fetchedAt: Date.now() });
      }
      setMetar(obs ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setMetarLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!airport) {
      setMetar(null);
      return;
    }
    const icao = iataToIcao(airport.iata);
    if (icao) fetchMetar(icao);
    else setMetar(null);

    return () => {
      abortRef.current?.abort();
    };
  }, [airport, fetchMetar]);

  const icao = airport ? iataToIcao(airport.iata) : null;

  const nearbyAtc =
    airport && icao ? findNearbyAtcFeeds(airport.lat, airport.lng, 30, 6) : [];

  // Group feeds for this airport only
  const airportFeeds = nearbyAtc.find((r) => r.icao === icao);

  const fltCat = decodeFltCat(metar?.fltcat);

  return (
    <AnimatePresence mode="wait">
      {airport && (
        <motion.div
          key={airport.iata}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 28,
            mass: 0.8,
          }}
          className="w-72 sm:w-80"
          role="complementary"
          aria-label="Airport information"
        >
          <div className="overflow-hidden rounded-2xl border border-foreground/8 bg-background/60 shadow-2xl shadow-background/40 backdrop-blur-2xl">
            <div className="p-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {metar ? (
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${fltCat.dotColor} shadow-sm`}
                        style={{ boxShadow: `0 0 6px 1px currentColor` }}
                      />
                    ) : (
                      <MapPin className="h-4 w-4 shrink-0 text-foreground/30" />
                    )}
                    <p className="truncate text-base font-bold text-foreground">
                      {airport.iata}
                    </p>
                    {icao && (
                      <span className="text-[10px] font-medium tracking-widest text-foreground/30 uppercase">
                        {icao}
                      </span>
                    )}
                    {metar && (
                      <span
                        className={`rounded-md bg-foreground/5 px-1.5 py-0.5 text-[9px] font-bold tracking-wider ring-1 ring-foreground/6 ${fltCat.color}`}
                      >
                        {fltCat.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] font-medium text-foreground/40">
                    {airport.name}
                  </p>
                  <p className="text-[10px] text-foreground/25">
                    {airport.city}, {airport.country}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-foreground/5 transition-colors hover:bg-foreground/10"
                  aria-label="Close airport info"
                >
                  <X className="h-3 w-3 text-foreground/40" />
                </button>
              </div>

              {/* Weather Section */}
              <div className="mt-3 h-px bg-linear-to-r from-transparent via-foreground/6 to-transparent" />

              {metarLoading && (
                <div className="mt-2.5 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-foreground/20" />
                  <span className="text-[10px] text-foreground/25">
                    Loading weather...
                  </span>
                </div>
              )}

              {metar && !metarLoading && (
                <div className="mt-2.5">
                  <p className="text-[10px] font-medium tracking-widest text-foreground/25 uppercase">
                    Current Weather
                  </p>

                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {/* Wind */}
                    <WeatherMetric
                      icon={<Wind className="h-3 w-3" />}
                      label="Wind"
                      value={
                        formatWindFromKnots(
                          metar.wdir,
                          metar.wspd,
                          metar.wgst,
                          settings.unitSystem,
                        )
                      }
                    />

                    {/* Visibility */}
                    <WeatherMetric
                      icon={<Eye className="h-3 w-3" />}
                      label="Visibility"
                      value={formatVisibility(metar.visib, settings.unitSystem)}
                    />

                    {/* Temperature */}
                    <WeatherMetric
                      icon={<Thermometer className="h-3 w-3" />}
                      label="Temp / Dew"
                      value={
                        metar.temp !== undefined
                          ? `${formatTemperatureC(metar.temp, settings.unitSystem)} / ${formatTemperatureC(metar.dewp, settings.unitSystem)}`
                          : "—"
                      }
                    />

                    {/* QNH */}
                    <WeatherMetric
                      icon={<Gauge className="h-3 w-3" />}
                      label="QNH"
                      value={
                        formatPressureHpa(metar.altim, settings.unitSystem)
                      }
                    />
                  </div>

                  {/* Clouds */}
                  {metar.clouds && metar.clouds.length > 0 && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4">
                      <Cloud className="mt-0.5 h-3 w-3 shrink-0 text-foreground/25" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-medium tracking-widest text-foreground/20 uppercase">
                          Cloud Layers
                        </span>
                        <p className="text-[11px] leading-snug text-foreground/45">
                          {metar.clouds
                            .map(
                              (c) =>
                                `${cloudCoverLabel(c.cover)}${formatCloudBaseHundredsFeet(c.base, settings.unitSystem)}`,
                            )
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Raw METAR */}
                  {metar.rawOb && (
                    <div className="mt-2 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4">
                      <p className="font-mono text-[9px] leading-relaxed text-foreground/25 break-all select-all">
                        {metar.rawOb}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!metar && !metarLoading && icao && (
                <div className="mt-2.5">
                  <p className="text-[10px] text-foreground/25">
                    No weather data available
                  </p>
                </div>
              )}

              {/* ATC Frequencies */}
              {airportFeeds && airportFeeds.feeds.length > 0 && (
                <>
                  <div className="mt-3 h-px bg-linear-to-r from-transparent via-foreground/6 to-transparent" />
                  <div className="mt-2.5">
                    <div className="flex items-center gap-1.5">
                      <Radio className="h-3 w-3 text-emerald-400/50" />
                      <p className="text-[10px] font-medium tracking-widest text-foreground/25 uppercase">
                        ATC Frequencies
                      </p>
                      <span className="ml-auto rounded-full bg-foreground/5 px-1.5 py-px text-[9px] font-medium tabular-nums text-foreground/20">
                        {airportFeeds.feeds.length}
                      </span>
                    </div>
                    <ScrollArea className="mt-1.5 max-h-28">
                      <div className="space-y-0.5">
                        {airportFeeds.feeds.map((feed) => (
                          <div
                            key={feed.id}
                            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/3"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/40" />
                              <span className="truncate text-[11px] text-foreground/45">
                                {feed.name}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground/35">
                              {feed.frequency}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </>
              )}

              {/* Coordinates */}
              <div className="mt-3 h-px bg-linear-to-r from-transparent via-foreground/6 to-transparent" />
              <div className="mt-2 flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-foreground/20" />
                <p className="font-mono text-[10px] tabular-nums text-foreground/25">
                  {Math.abs(airport.lat).toFixed(4)}°
                  {airport.lat >= 0 ? "N" : "S"},{" "}
                  {Math.abs(airport.lng).toFixed(4)}°
                  {airport.lng >= 0 ? "E" : "W"}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function WeatherMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4">
      <div className="flex items-center gap-1 text-foreground/25">
        {icon}
        <span className="text-[9px] font-medium tracking-widest uppercase">
          {label}
        </span>
      </div>
      <p className="text-[12px] font-semibold tabular-nums text-foreground/80">
        {value}
      </p>
    </div>
  );
}

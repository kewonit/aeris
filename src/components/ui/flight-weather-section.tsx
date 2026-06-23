"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDown,
  Cloud,
  Loader2,
} from "lucide-react";
import type { UnitSystem } from "@/hooks/use-settings";
import type { FlightRouteInfo } from "@/hooks/use-route-info";
import {
  useMetar,
  useTaf,
} from "@/components/ui/airport-info-card/use-airport-data";
import { WeatherSection } from "@/components/ui/airport-info-card/weather-section";
import { TafSection } from "@/components/ui/airport-info-card/taf-section";

type FlightWeatherSectionProps = {
  routeInfo: FlightRouteInfo;
  unitSystem: UnitSystem;
};

function AirportWeatherCompact({
  icao,
  label,
  unitSystem,
}: {
  icao: string | null;
  label: string;
  unitSystem: UnitSystem;
}) {
  const [tafOpen, setTafOpen] = useState(false);
  const { metar, loading: metarLoading } = useMetar(icao);
  const { taf, loading: tafLoading } = useTaf(icao);

  const hasData = metar || metarLoading || taf || tafLoading;
  if (!icao || !hasData) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.06] bg-background/45 text-foreground/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <Cloud className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/72">
          {label}
        </span>
        {metarLoading && !metar && (
          <Loader2 className="h-3 w-3 animate-spin text-foreground/30" />
        )}
      </div>

      <WeatherSection
        metar={metar}
        loading={metarLoading}
        hasIcao={!!icao}
        unitSystem={unitSystem}
      />

      {(tafLoading || taf) && (
        <div>
          <button
            type="button"
            onClick={() => setTafOpen((o) => !o)}
            className="flex min-h-9 w-full items-center gap-2 rounded-[14px] px-2 text-left transition-colors hover:bg-foreground/[0.04] active:bg-foreground/[0.07]"
            aria-expanded={tafOpen}
          >
            <span className="text-[12px] font-medium text-foreground/55">
              Forecast
            </span>
            <ChevronDown
              className={`ml-auto h-3.5 w-3.5 text-foreground/24 transition-transform duration-200 ${tafOpen ? "rotate-180" : ""}`}
            />
          </button>
          <AnimatePresence initial={false}>
            {tafOpen && (
              <motion.div
                key="taf"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="pt-1.5">
                  <TafSection taf={taf} loading={tafLoading} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/**
 * Weather section for FlightCard.
 * Fetches and displays METAR/TAF for origin and destination airports.
 * Returns null if no verified route is available.
 */
export function FlightWeatherSection({
  routeInfo,
  unitSystem,
}: FlightWeatherSectionProps) {
  if (!routeInfo.available) return null;

  const originIcao = routeInfo.origin?.icao ?? null;
  const destIcao = routeInfo.destination?.icao ?? null;

  if (!originIcao && !destIcao) return null;

  return (
    <div className="space-y-3 rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      {originIcao && (
        <AirportWeatherCompact
          icao={originIcao}
          label={`${routeInfo.origin?.iata || routeInfo.origin?.icao || "Origin"} Weather`}
          unitSystem={unitSystem}
        />
      )}
      {destIcao && (
        <AirportWeatherCompact
          icao={destIcao}
          label={`${routeInfo.destination?.iata || routeInfo.destination?.icao || "Dest"} Weather`}
          unitSystem={unitSystem}
        />
      )}
    </div>
  );
}

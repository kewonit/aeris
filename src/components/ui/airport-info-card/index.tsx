"use client";

import { useMemo, useState } from "react";
import { motion, useDragControls, useReducedMotion } from "motion/react";
import { Cloud, Info, Plane } from "lucide-react";
import type { AirportBoardData } from "@/hooks/use-airport-board";
import type { Airport } from "@/lib/airports";
import { findNearbyAtcFeeds, iataToIcao } from "@/lib/atc-lookup";
import { getRunways } from "@/lib/airport-runways";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import { useSettings } from "@/hooks/use-settings";
import { ArrDepTabs, type ArrDepTab } from "./arr-dep-tabs";
import { AtcFrequencies } from "./atc-frequencies";
import { AirportFacts } from "./airport-facts";
import { Coordinates } from "./bits";
import { CardHeader } from "./card-header";
import { FlightList } from "./flight-list";
import { MainTabs, type MainTab } from "./main-tabs";
import { PhotoBanner } from "./photo-banner";
import { RunwaysList } from "./runways-list";
import { TafSection } from "./taf-section";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAirportPhoto, useMetar, useTaf } from "./use-airport-data";
import { WeatherSection } from "./weather-section";

export type AirportInfoCardProps = {
  /** Full board data (airport + flights). When null or `isActive=false`, card hides. */
  board: AirportBoardData;
  /** Click handler for a flight row. */
  onSelectFlight: (icao24: string) => void;
  /** ICAO24 of currently focused flight (for row highlight). */
  selectedIcao24: string | null;
  /** Close the card. */
  onClose: () => void;
  /** Shared ATC stream - when provided, frequency rows become interactive. */
  atc?: UseAtcStreamReturn;
  /**
   * `"sidebar"` fills the desktop left sidebar. `"mobile"` is a bottom sheet
   * that slides up and can be dragged down to close.
   */
  variant: "mobile" | "sidebar";
};

/**
 * Airport details: photo, header, facts with live traffic counts, and tabs
 * for the flight board, weather, and runway and frequency info.
 */
export function AirportInfoCard({
  board,
  onSelectFlight,
  selectedIcao24,
  onClose,
  atc,
  variant,
}: AirportInfoCardProps) {
  const airport: Airport | null = board.airport;
  const { settings } = useSettings();
  const [collapsed, setCollapsed] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("flights");
  const [arrDepTab, setArrDepTab] = useState<ArrDepTab>("arrivals");
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();

  // Prefer DB ICAO; fall back to curated LiveATC map.
  const icao = useMemo(() => {
    if (!airport) return null;
    return airport.icao || iataToIcao(airport.iata);
  }, [airport]);

  const { metar, loading: metarLoading } = useMetar(icao);
  const { taf, loading: tafLoading } = useTaf(icao);
  const photoLookup = useMemo(
    () =>
      airport
        ? {
            cacheKey: icao ?? airport.iata,
            name: airport.name,
            iata: airport.iata,
            icao,
            city: airport.city,
          }
        : null,
    [airport, icao],
  );

  const photoState = useAirportPhoto(photoLookup);

  const runways = useMemo(() => (icao ? getRunways(icao) : []), [icao]);

  const airportFeeds = useMemo(() => {
    if (!airport || !icao) return null;
    const nearby = findNearbyAtcFeeds(airport.lat, airport.lng, 30, 6);
    return nearby.find((r) => r.icao === icao) ?? null;
  }, [airport, icao]);

  // Auto-fall back when the preferred tab has nothing to show.
  // Compute during render - avoids setState-in-effect cascades.
  const hasFlights = board.totalFlights > 0;
  const hasWeather = !!metar;
  const effectiveMainTab: MainTab =
    mainTab === "flights" && !hasFlights
      ? hasWeather
        ? "weather"
        : "info"
      : mainTab;

  const effectiveArrDep: ArrDepTab =
    arrDepTab === "arrivals" &&
    board.arrivals.length === 0 &&
    board.departures.length > 0
      ? "departures"
      : arrDepTab === "departures" &&
          board.departures.length === 0 &&
          board.arrivals.length > 0
        ? "arrivals"
        : arrDepTab;

  if (!airport || !board.isActive) return null;

  const isMobile = variant === "mobile";
  const slide = isMobile && !reduceMotion;
  const showTraffic = (kind: ArrDepTab) => {
    setMainTab("flights");
    setArrDepTab(kind);
  };

  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 [scrollbar-width:thin]">
      {!collapsed && (
        <PhotoBanner
          photo={photoState.photo}
          loading={photoState.loading}
          errored={photoState.errored}
          onError={photoState.markErrored}
          airportName={airport.name}
        />
      )}
      <CardHeader
        airport={airport}
        icao={icao}
        metar={metar}
        sheet={
          isMobile
            ? {
                collapsed,
                onToggleCollapse: () => setCollapsed((value) => !value),
                onClose,
              }
            : undefined
        }
      />

      {!collapsed && (
        <div className="px-6">
          <AirportFacts
            elevationFt={airport.elevation_ft}
            unitSystem={settings.unitSystem}
            runways={runways.length}
            arrivals={board.arrivals.length}
            departures={board.departures.length}
            overflights={board.overflights.length}
            onShowTraffic={showTraffic}
            activeTraffic={effectiveMainTab === "flights" ? effectiveArrDep : null}
          />

          <Tabs
            value={effectiveMainTab}
            onValueChange={(value) => setMainTab(value as MainTab)}
            className="mt-5"
          >
            <MainTabs
              tabs={[
                { id: "flights", label: "Flights", icon: Plane },
                { id: "weather", label: "Weather", icon: Cloud },
                { id: "info", label: "Info", icon: Info },
              ]}
            />

            <TabsContent value="flights" className="mt-4">
              {hasFlights ? (
                <Tabs
                  value={effectiveArrDep}
                  onValueChange={(value) => setArrDepTab(value as ArrDepTab)}
                >
                  <ArrDepTabs
                    arrivals={board.arrivals.length}
                    departures={board.departures.length}
                  />
                  <TabsContent value="arrivals" className="mt-2">
                    <FlightList
                      flights={board.arrivals}
                      selectedIcao24={selectedIcao24}
                      onSelectFlight={onSelectFlight}
                      emptyMessage="No arriving flights"
                    />
                  </TabsContent>
                  <TabsContent value="departures" className="mt-2">
                    <FlightList
                      flights={board.departures}
                      selectedIcao24={selectedIcao24}
                      onSelectFlight={onSelectFlight}
                      emptyMessage="No departing flights"
                    />
                  </TabsContent>
                </Tabs>
              ) : (
                <p className="py-8 text-center text-small text-subtle">
                  No air traffic nearby
                </p>
              )}
            </TabsContent>

            <TabsContent value="weather" className="mt-4 flex flex-col gap-5">
              <WeatherSection
                metar={metar}
                loading={metarLoading}
                hasIcao={!!icao}
                unitSystem={settings.unitSystem}
              />
              {(tafLoading || taf) && <TafSection taf={taf} loading={tafLoading} />}
            </TabsContent>

            <TabsContent value="info" className="mt-4 flex flex-col gap-5">
              <RunwaysList
                runways={runways}
                metric={settings.unitSystem === "metric"}
              />
              {airportFeeds && airportFeeds.feeds.length > 0 && (
                <AtcFrequencies feeds={airportFeeds.feeds} atc={atc} />
              )}
              <Coordinates lat={airport.lat} lng={airport.lng} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );

  if (!isMobile) return <div className="flex h-full flex-col">{body}</div>;

  return (
    <motion.section
      aria-label="Airport details"
      initial={slide ? { y: "100%" } : false}
      animate={slide ? { y: 0 } : undefined}
      exit={slide ? { y: "100%" } : { opacity: 0 }}
      transition={
        slide
          ? { type: "spring", stiffness: 400, damping: 28, mass: 0.8 }
          : { duration: 0 }
      }
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 100 || info.velocity.y > 350) onClose();
      }}
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]"
    >
      <div className="relative flex max-h-[85dvh] flex-col overflow-hidden rounded-xl bg-background shadow-lift">
        <button
          type="button"
          onPointerDown={(event) => dragControls.start(event)}
          className="absolute top-0 left-1/2 z-10 grid h-6 w-28 -translate-x-1/2 cursor-grab touch-none place-items-center active:cursor-grabbing"
          aria-label="Drag down to close"
        >
          <span className="block h-1 w-10 rounded-full bg-border" />
        </button>
        {body}
      </div>
    </motion.section>
  );
}

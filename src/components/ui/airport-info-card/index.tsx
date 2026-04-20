"use client";

import { useMemo, useState } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
} from "motion/react";
import { Cloud, Info, Plane } from "lucide-react";
import type { AirportBoardData } from "@/hooks/use-airport-board";
import type { Airport } from "@/lib/airports";
import { findNearbyAtcFeeds, iataToIcao } from "@/lib/atc-lookup";
import { getRunways } from "@/lib/airport-runways";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import { useSettings } from "@/hooks/use-settings";
import { ArrDepTabs, type ArrDepTab } from "./arr-dep-tabs";
import { AtcFrequencies } from "./atc-frequencies";
import { Coordinates, Divider } from "./bits";
import { CardHeader } from "./card-header";
import { FactTiles } from "./fact-tiles";
import { FlightList } from "./flight-list";
import { MainTabs, type MainTab } from "./main-tabs";
import { PhotoBanner } from "./photo-banner";
import { RunwaysList } from "./runways-list";
import { TafSection } from "./taf-section";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TrafficTiles } from "./traffic-tiles";
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
  /** Shared ATC stream — when provided, frequency rows become interactive. */
  atc?: UseAtcStreamReturn;
  /**
   * Layout variant:
   * - `"desktop"` (default): fixed width, max-height minus top bar, mounted/exit slides up.
   * - `"mobile"`: full width, taller max-height, subdued entrance (parent handles drag).
   */
  variant?: "desktop" | "mobile";
};

/**
 * Unified airport card: photo, header, key facts, live traffic counts,
 * a tabbed body (Flights / Weather / Info), and a coordinates footer.
 *
 * Replaces the previous two-card layout (AirportBoard + AirportInfoCard).
 */
export function AirportInfoCard({
  board,
  onSelectFlight,
  selectedIcao24,
  onClose,
  atc,
  variant = "desktop",
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
  // Compute during render — avoids setState-in-effect cascades.
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
  const outerClass = isMobile
    ? "pointer-events-auto fixed inset-x-0 bottom-0 z-40 w-full px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]"
    : "w-80 sm:w-96";
  const innerMaxH = isMobile ? "max-h-[85dvh]" : "max-h-[calc(100dvh-5rem)]";

  const cardInitial = reduceMotion
    ? false
    : isMobile
      ? { y: "100%" as const }
      : { opacity: 0, y: 12, scale: 0.97 };
  const cardAnimate = isMobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 };
  const cardExit = reduceMotion
    ? { opacity: 0 }
    : isMobile
      ? { y: "100%" as const }
      : { opacity: 0, y: 12, scale: 0.97 };

  return (
    <motion.div
      layout={isMobile ? false : "position"}
      initial={cardInitial}
      animate={cardAnimate}
      exit={cardExit}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 400, damping: 28, mass: 0.8 }
      }
      className={outerClass}
      role="complementary"
      aria-label="Airport information"
      drag={isMobile ? "y" : false}
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => {
        if (isMobile && (info.offset.y > 100 || info.velocity.y > 350)) {
          onClose();
        }
      }}
    >
      <div
        className={`relative flex ${innerMaxH} flex-col overflow-hidden rounded-2xl bg-background/60 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.4),0_24px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-2xl dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_0_0_1px_rgba(255,255,255,0.06),0_8px_24px_-8px_rgba(0,0,0,0.6),0_24px_64px_-16px_rgba(0,0,0,0.8)]`}
      >
        {isMobile && (
          <>
            {/* Visual gradient scrim — pointer-events none so it doesn't eat the close-button taps. */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-linear-to-b from-background/40 to-transparent"
              aria-hidden
            />
            {/* Drag grab target — centered pill, narrow hit area. */}
            <button
              type="button"
              onPointerDown={(e) => dragControls.start(e)}
              className="absolute top-0 left-1/2 z-20 flex h-10 w-28 -translate-x-1/2 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
              aria-label="Drag handle — drag down to dismiss"
            >
              <span className="block h-1 w-12 rounded-full bg-foreground/55 shadow-sm" />
            </button>
          </>
        )}
        <PhotoBanner
          photo={photoState.photo}
          loading={photoState.loading}
          errored={photoState.errored}
          onError={photoState.markErrored}
          airportName={airport.name}
          iata={airport.iata}
          icao={icao}
          city={airport.city}
          country={airport.country}
          onClose={isMobile ? undefined : onClose}
        />

        <CardHeader
          airport={airport}
          icao={icao}
          metar={metar}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.28,
                ease: [0.25, 0.1, 0.25, 1],
              }}
              className="flex min-h-0 flex-col overflow-hidden"
            >
              <Divider />

              <Tabs
                value={effectiveMainTab}
                onValueChange={(v) => setMainTab(v as MainTab)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex flex-col gap-3 px-4 pt-3">
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.28,
                      delay: reduceMotion ? 0 : 0.04,
                      ease: [0.2, 0, 0, 1],
                    }}
                  >
                    <FactTiles
                      elevationFt={airport.elevation_ft}
                      unitSystem={settings.unitSystem}
                    />
                  </motion.div>

                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.28,
                      delay: reduceMotion ? 0 : 0.14,
                      ease: [0.2, 0, 0, 1],
                    }}
                  >
                    <TrafficTiles
                      arrivals={board.arrivals.length}
                      departures={board.departures.length}
                      overflights={board.overflights.length}
                      onSelectArrivals={() => {
                        setMainTab("flights");
                        setArrDepTab("arrivals");
                      }}
                      onSelectDepartures={() => {
                        setMainTab("flights");
                        setArrDepTab("departures");
                      }}
                      activeKind={
                        effectiveMainTab === "flights" ? effectiveArrDep : null
                      }
                    />
                  </motion.div>

                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.28,
                      delay: reduceMotion ? 0 : 0.24,
                      ease: [0.2, 0, 0, 1],
                    }}
                  >
                    <MainTabs
                      tabs={[
                        { id: "flights", label: "Flights", icon: Plane },
                        { id: "weather", label: "Weather", icon: Cloud },
                        { id: "info", label: "Info", icon: Info },
                      ]}
                    />
                  </motion.div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4 [scrollbar-width:thin]">
                  <TabsContent
                    value="flights"
                    className="flex flex-col gap-3 data-[state=inactive]:hidden"
                  >
                    {hasFlights ? (
                      <Tabs
                        value={effectiveArrDep}
                        onValueChange={(v) => setArrDepTab(v as ArrDepTab)}
                        className="flex flex-col gap-3"
                      >
                        <ArrDepTabs
                          arrivals={board.arrivals.length}
                          departures={board.departures.length}
                        />
                        <TabsContent
                          value="arrivals"
                          className="data-[state=inactive]:hidden"
                        >
                          <FlightList
                            flights={board.arrivals}
                            selectedIcao24={selectedIcao24}
                            onSelectFlight={onSelectFlight}
                            emptyMessage="No arriving flights"
                          />
                        </TabsContent>
                        <TabsContent
                          value="departures"
                          className="data-[state=inactive]:hidden"
                        >
                          <FlightList
                            flights={board.departures}
                            selectedIcao24={selectedIcao24}
                            onSelectFlight={onSelectFlight}
                            emptyMessage="No departing flights"
                          />
                        </TabsContent>
                      </Tabs>
                    ) : (
                      <div className="flex h-32 items-center justify-center text-[11px] font-medium text-foreground/30">
                        No air traffic nearby
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent
                    value="weather"
                    className="flex flex-col gap-3 data-[state=inactive]:hidden"
                  >
                    <WeatherSection
                      metar={metar}
                      loading={metarLoading}
                      hasIcao={!!icao}
                      unitSystem={settings.unitSystem}
                    />
                    {(tafLoading || taf) && (
                      <TafSection taf={taf} loading={tafLoading} />
                    )}
                  </TabsContent>

                  <TabsContent
                    value="info"
                    className="flex flex-col gap-3 data-[state=inactive]:hidden"
                  >
                    <RunwaysList
                      runways={runways}
                      metric={settings.unitSystem === "metric"}
                    />
                    {airportFeeds && airportFeeds.feeds.length > 0 && (
                      <AtcFrequencies feeds={airportFeeds.feeds} atc={atc} />
                    )}
                    <Coordinates lat={airport.lat} lng={airport.lng} />
                  </TabsContent>
                </div>
              </Tabs>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

"use client";

import { memo, useMemo, useState } from "react";
import { Cloud, Info, PlaneLanding, PlaneTakeoff } from "lucide-react";
import type { AirportBoardData } from "@/hooks/use-airport-board";
import type { Airport } from "@/lib/airports";
import { findNearbyAtcFeeds, iataToIcao } from "@/lib/atc-lookup";
import { getRunways } from "@/lib/airport-runways";
import { describeNotableWeather } from "@/lib/metar-words";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import { useSettings } from "@/hooks/use-settings";
import { AtcFrequencies } from "./atc-frequencies";
import { AirportFacts } from "./airport-facts";
import { Coordinates } from "./bits";
import { CardHeader } from "./card-header";
import { FlightList } from "./flight-list";
import { PhotoBanner } from "./photo-banner";
import { RunwaysList } from "./runways-list";
import { TafSection } from "./taf-section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAirportPhoto, useMetar, useTaf } from "./use-airport-data";
import { WeatherSection } from "./weather-section";

type AirportTab = "arrivals" | "departures" | "weather" | "info";

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
};

/**
 * One airport, on the phone's sheet and the desktop's panel: what is
 * happening there in a line, then the board, the weather and the details.
 * The surface it sits in does the scrolling.
 */
export const AirportInfoCard = memo(function AirportInfoCard({
  board,
  onSelectFlight,
  selectedIcao24,
  onClose,
  atc,
}: AirportInfoCardProps) {
  const airport: Airport | null = board.airport;
  const { settings } = useSettings();
  const [tab, setTab] = useState<AirportTab>("arrivals");

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

  // An empty board falls back to whichever tab has something to show.
  // Computed during render, so no state is set in an effect.
  const arrivals = board.arrivals.length;
  const departures = board.departures.length;
  const effectiveTab: AirportTab =
    tab === "arrivals" && arrivals === 0 && departures > 0
      ? "departures"
      : tab === "departures" && departures === 0 && arrivals > 0
        ? "arrivals"
        : tab;

  if (!airport || !board.isActive) return null;

  const weather = describeNotableWeather(airport.iata, metar, settings.unitSystem);
  const traffic =
    arrivals + departures > 0
      ? [
          arrivals ? `${arrivals} arriving` : null,
          departures ? `${departures} departing` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Quiet right now";

  return (
    <article aria-label={`${airport.iata} airport`} className="pb-6">
      <CardHeader airport={airport} icao={icao} metar={metar} onClose={onClose} />

      <section aria-label="Status" data-sheet-peek className="px-5 pt-3 pb-1">
        <p className="text-value text-foreground">{traffic}</p>
        {weather && (
          <p className="mt-1 text-small text-warning">
            {weather.slice(weather.indexOf(":") + 2)}
          </p>
        )}
      </section>

      <div className="mt-4">
        <PhotoBanner
          photo={photoState.photo}
          loading={photoState.loading}
          errored={photoState.errored}
          onError={photoState.markErrored}
          airportName={airport.name}
        />
      </div>

      <div className="px-5">
        <AirportFacts
          elevationFt={airport.elevation_ft}
          unitSystem={settings.unitSystem}
          runways={runways.length}
        />

        <Tabs
          value={effectiveTab}
          onValueChange={(value) => setTab(value as AirportTab)}
          className="mt-5"
        >
          <TabsList>
            <TabsTrigger value="arrivals" className="data-[state=active]:text-arrival">
              <PlaneLanding className="size-3.5" aria-hidden="true" />
              Arrivals
            </TabsTrigger>
            <TabsTrigger value="departures" className="data-[state=active]:text-departure">
              <PlaneTakeoff className="size-3.5" aria-hidden="true" />
              Departures
            </TabsTrigger>
            <TabsTrigger value="weather">
              <Cloud className="size-3.5" aria-hidden="true" />
              Weather
            </TabsTrigger>
            <TabsTrigger value="info">
              <Info className="size-3.5" aria-hidden="true" />
              Info
            </TabsTrigger>
          </TabsList>

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
    </article>
  );
});

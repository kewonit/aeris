"use client";

import { useEffect, useMemo, useState } from "react";
import type { FlightState } from "@/lib/opensky";
import { searchFlightsGlobal } from "@/lib/search-flight-client";
import {
  searchGeocode,
  searchLocalLocations,
  type SearchLocation,
} from "@/lib/search-location-client";
import {
  classifySearchQuery,
  matchLiveFlights,
  nearestFlights,
} from "@/lib/search-query";

const FLIGHT_DEBOUNCE_MS = 300;
const PLACE_DEBOUNCE_MS = 350;

export type UnifiedSearchResults = {
  /** Live aircraft: those on the map first, then any found worldwide. */
  flights: FlightState[];
  /** Airports and featured cities, each with an airport code. */
  airports: SearchLocation[];
  /** Places from the geocoder, to fly the map to. */
  places: SearchLocation[];
  /** With an empty box: the aircraft nearest the map's centre. */
  nearby: FlightState[];
  /** An airport code matched exactly, so airports should lead. */
  airportFirst: boolean;
  /** The worldwide lookups still running. */
  searchingFlights: boolean;
  searchingPlaces: boolean;
  /** The query reads like a flight, so Enter can look it up worldwide. */
  flightLike: boolean;
};

/**
 * One query, every source: the aircraft already on the map at once,
 * airports at once, then live flights worldwide and places by name. Each
 * slow source runs only when the query could be one of its kind, so a
 * callsign never asks the geocoder and a city never asks the feed.
 */
export function useUnifiedSearch(
  query: string,
  flights: FlightState[],
  center: [number, number],
): UnifiedSearchResults {
  const trimmed = query.trim();
  const kind = useMemo(() => classifySearchQuery(trimmed), [trimmed]);
  const wantsFlights =
    kind.compact.length >= 3 &&
    (kind.flightLike || kind.hex || kind.registrationLike);
  const local = useMemo(() => searchLocalLocations(trimmed, 8), [trimmed]);
  // An airport code typed exactly is the airport, not a place by that name.
  const exactAirport = useMemo(() => {
    if (!kind.airportCodeLike) return false;
    const code = kind.compact.toUpperCase();
    return [...local.cities, ...local.airports].some(
      (a) => a.code.toUpperCase() === code,
    );
  }, [kind, local]);
  const wantsPlaces = kind.placeLike && !exactAirport;

  const [global, setGlobal] = useState<{
    query: string;
    flights: FlightState[];
  } | null>(null);
  const [geo, setGeo] = useState<{
    query: string;
    places: SearchLocation[];
  } | null>(null);

  useEffect(() => {
    if (!wantsFlights) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchFlightsGlobal(trimmed, controller.signal).then((found) => {
        if (!controller.signal.aborted) setGlobal({ query: trimmed, flights: found });
      });
    }, FLIGHT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, wantsFlights]);

  useEffect(() => {
    if (!wantsPlaces) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchGeocode(trimmed, controller.signal).then((found) => {
        if (!controller.signal.aborted) setGeo({ query: trimmed, places: found });
      });
    }, PLACE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, wantsPlaces]);

  const live = useMemo(() => matchLiveFlights(trimmed, flights), [trimmed, flights]);
  const nearby = useMemo(
    () => (trimmed ? [] : nearestFlights(flights, center)),
    [trimmed, flights, center],
  );

  return useMemo(() => {
    const worldwide = global?.query === trimmed ? global.flights : [];
    const seen = new Set(live.map((f) => f.icao24));
    const combined = [...live, ...worldwide.filter((f) => !seen.has(f.icao24))];

    const airports = [...local.cities, ...local.airports];
    const code = kind.compact.toUpperCase();
    const exactIndex = airports.findIndex((a) => a.code.toUpperCase() === code);
    if (exactIndex > 0) airports.unshift(...airports.splice(exactIndex, 1));

    const codes = new Set(airports.map((a) => a.name.toLowerCase()));
    const places =
      geo?.query === trimmed
        ? geo.places.filter((p) => !codes.has(p.name.toLowerCase())).slice(0, 5)
        : [];

    return {
      flights: combined.slice(0, 8),
      airports: airports.slice(0, 6),
      places,
      nearby,
      airportFirst: exactIndex >= 0 && kind.airportCodeLike,
      searchingFlights: wantsFlights && global?.query !== trimmed,
      searchingPlaces: wantsPlaces && geo?.query !== trimmed,
      flightLike: kind.flightLike || kind.hex || kind.registrationLike,
    };
  }, [geo, global, kind, live, local, nearby, trimmed, wantsFlights, wantsPlaces]);
}

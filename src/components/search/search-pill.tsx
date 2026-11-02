"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Command } from "cmdk";
import { Loader2, MapPin, Plane, Search, X } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { useUnifiedSearch } from "@/hooks/use-unified-search";
import { lookupAirline } from "@/lib/airlines";
import type { FlightState } from "@/lib/opensky";
import type { SearchLocation } from "@/lib/search-location-client";
import { formatAltitude } from "@/lib/unit-formatters";
import { AirlineLogo } from "@/components/ui/airline-logo";

type SearchPillProps = {
  flights: FlightState[];
  /** Where "nearby" is measured from. */
  center: [number, number];
  onSelectFlight: (flight: FlightState) => void;
  onSelectAirport: (location: SearchLocation) => void;
  onSelectPlace: (location: SearchLocation) => void;
  /** Looks a flight up worldwide by what was typed; false when none found. */
  onLookupFlight: (query: string) => Promise<boolean>;
  /** Shown at the start of the field, such as the menu button on a phone. */
  trailing?: ReactNode;
};

/**
 * One field for everything: callsigns, flight numbers, addresses,
 * registrations, airport codes, cities and places. It never covers the map;
 * results drop down beneath it and open the aircraft or the airport straight
 * away. "/" and ⌘K reach it from anywhere.
 */
export const SearchPill = memo(function SearchPill({
  flights,
  center,
  onSelectFlight,
  onSelectAirport,
  onSelectPlace,
  onLookupFlight,
  trailing,
}: SearchPillProps) {
  const { settings } = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState<{
    query: string;
    state: "busy" | "missing";
  } | null>(null);
  const results = useUnifiedSearch(query, flights, center);
  const trimmed = query.trim();
  const lookupState = lookup?.query === trimmed ? lookup.state : null;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setLookup(null);
    inputRef.current?.blur();
  }, []);

  useEffect(() => {
    const focus = () => {
      setOpen(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("aeris:open-search", focus);
    return () => window.removeEventListener("aeris:open-search", focus);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pickFlight = useCallback(
    (flight: FlightState) => {
      close();
      onSelectFlight(flight);
    },
    [close, onSelectFlight],
  );

  const runLookup = useCallback(async () => {
    if (!trimmed || lookupState === "busy") return;
    setLookup({ query: trimmed, state: "busy" });
    const found = await onLookupFlight(trimmed);
    if (found) close();
    else setLookup({ query: trimmed, state: "missing" });
  }, [close, lookupState, onLookupFlight, trimmed]);

  const hasResults =
    results.flights.length +
      results.airports.length +
      results.places.length +
      results.nearby.length >
    0;
  const searching = results.searchingFlights || results.searchingPlaces;

  const flightGroup = (heading: string, list: FlightState[]) =>
    list.length > 0 && (
      <Command.Group heading={heading}>
        {list.map((flight) => (
          <FlightRow
            key={flight.icao24}
            flight={flight}
            altitude={formatAltitude(flight.baroAltitude, settings.unitSystem)}
            onSelect={() => pickFlight(flight)}
          />
        ))}
      </Command.Group>
    );
  const airportGroup = results.airports.length > 0 && (
    <Command.Group heading={trimmed ? "Airports" : "Popular airports"}>
      {results.airports.map((airport) => (
        <LocationRow
          key={airport.id}
          location={airport}
          onSelect={() => {
            close();
            onSelectAirport(airport);
          }}
        />
      ))}
    </Command.Group>
  );

  return (
    <div ref={rootRef} className="relative w-full">
      <Command
        shouldFilter={false}
        loop
        label="Search flights, airports and places"
        className="aeris-cmdk"
      >
        <div className="aeris-float aeris-glass flex h-11 items-center gap-2 rounded-full pr-1 pl-4">
          <Search className="size-4 shrink-0 text-subtle" aria-hidden="true" />
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                if (query) setQuery("");
                else close();
              } else if (
                event.key === "Enter" &&
                results.flights.length === 0 &&
                results.flightLike
              ) {
                event.preventDefault();
                void runLookup();
              }
            }}
            placeholder="Flights, airports, places"
            aria-keyshortcuts="/ Meta+K"
            className="h-full min-w-0 flex-1 bg-transparent text-body text-foreground placeholder:text-subtle"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="grid size-9 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : (
            !open && (
              <kbd className="mr-2 hidden rounded-sm border border-border px-1.5 font-mono text-label text-subtle pointer-fine:block">
                /
              </kbd>
            )
          )}
          {trailing}
        </div>

        {open && (
          <div className="aeris-pop absolute inset-x-0 top-full z-10 mt-2 overflow-hidden aeris-float rounded-xl">
            <Command.List className="max-h-[min(60dvh,30rem)] overflow-y-auto py-1.5">
              {results.airportFirst ? (
                <>
                  {airportGroup}
                  {flightGroup("Flights", results.flights)}
                </>
              ) : (
                <>
                  {flightGroup(trimmed ? "Flights" : "Nearby", trimmed ? results.flights : results.nearby)}
                  {airportGroup}
                </>
              )}
              {results.places.length > 0 && (
                <Command.Group heading="Places">
                  {results.places.map((place) => (
                    <LocationRow
                      key={place.id}
                      location={place}
                      onSelect={() => {
                        close();
                        onSelectPlace(place);
                      }}
                    />
                  ))}
                </Command.Group>
              )}

              {trimmed && results.flightLike && results.flights.length === 0 && !results.searchingFlights && (
                <Command.Item
                  value="lookup"
                  onSelect={() => void runLookup()}
                  className="search-item text-small text-muted-foreground"
                >
                  {lookupState === "busy" ? (
                    <Loader2 className="size-4 animate-spin text-subtle" aria-hidden="true" />
                  ) : (
                    <Search className="size-4 text-subtle" aria-hidden="true" />
                  )}
                  {lookupState === "missing"
                    ? `No live flight for ${trimmed.toUpperCase()} · on the ground or out of coverage`
                    : `Search all flights for “${trimmed}”`}
                </Command.Item>
              )}

              {searching && !hasResults && (
                <p className="flex items-center gap-2 px-5 py-3 text-small text-subtle">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Searching…
                </p>
              )}
              {trimmed && !searching && !hasResults && !results.flightLike && (
                <p className="px-5 py-3 text-small text-subtle">
                  Nothing found for “{trimmed}”
                </p>
              )}
            </Command.List>
          </div>
        )}
      </Command>
    </div>
  );
});

function FlightRow({
  flight,
  altitude,
  onSelect,
}: {
  flight: FlightState;
  altitude: string;
  onSelect: () => void;
}) {
  const callsign = flight.callsign?.trim() || flight.icao24.toUpperCase();
  const airline = lookupAirline(flight.callsign);
  const detail = [
    airline,
    flight.typeCode,
    flight.registration,
    flight.onGround ? "On the ground" : altitude !== "-" ? altitude : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Command.Item
      value={`flight:${flight.icao24}`}
      onSelect={onSelect}
      className="search-item"
    >
      {airline ? (
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-sm bg-white">
          <AirlineLogo
            callsign={flight.callsign}
            airlineName={airline}
            size={22}
            className="rounded-none bg-transparent"
          />
        </span>
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-card text-subtle">
          <Plane className="size-4 -rotate-45" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small text-foreground">{callsign}</span>
        <span className="block truncate text-label text-subtle">{detail}</span>
      </span>
    </Command.Item>
  );
}

const REGION_NAMES =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

/** "IN" as "India"; anything that is not a region code as it is. */
function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return REGION_NAMES?.of(code) ?? code;
  } catch {
    return code;
  }
}

function LocationRow({
  location,
  onSelect,
}: {
  location: SearchLocation;
  onSelect: () => void;
}) {
  const isAirport = location.source !== "place";
  return (
    <Command.Item
      value={`location:${location.id}`}
      onSelect={onSelect}
      className="search-item"
    >
      {isAirport ? (
        <span className="w-8 shrink-0 text-small text-foreground">
          {location.code}
        </span>
      ) : (
        <span className="grid size-8 shrink-0 place-items-center text-subtle">
          <MapPin className="size-4" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small text-foreground">
          {location.name}
        </span>
        <span className="block truncate text-label text-subtle">
          {location.source === "airport"
            ? (location.displayName.split(" — ")[1] ?? countryName(location.country))
            : isAirport
              ? countryName(location.country)
              : location.displayName}
        </span>
      </span>
    </Command.Item>
  );
}

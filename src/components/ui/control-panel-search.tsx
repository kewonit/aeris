"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search,
  X,
  MapPin,
  ChevronRight,
  Plane,
  Eye,
  Loader2,
} from "lucide-react";
import { CITIES, type City } from "@/lib/cities";
import { searchAirports, airportToCity } from "@/lib/airports";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FlightState } from "@/lib/opensky";
import { formatCallsign } from "@/lib/flight-utils";

export function SearchContent({
  activeCity,
  onSelect,
  flights,
  activeFlightIcao24,
  onLookupFlight,
}: {
  activeCity: City;
  onSelect: (city: City) => void;
  flights: FlightState[];
  activeFlightIcao24: string | null;
  onLookupFlight: (query: string, enterFpv?: boolean) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const { featured, airports } = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q)
      return {
        featured: CITIES,
        airports: [] as ReturnType<typeof searchAirports>,
      };

    const featured = CITIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iata.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q),
    );

    const featuredIatas = new Set(CITIES.map((c) => c.iata));
    const airports = searchAirports(q).filter(
      (a) => !featuredIatas.has(a.iata),
    );

    return { featured, airports };
  }, [query]);

  const normalizedQuery = query.trim().toLowerCase();
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const isIcao24Query = /^[0-9a-f]{6}$/.test(compactQuery);

  const flightMatches = useMemo(() => {
    if (!compactQuery) return [] as FlightState[];
    return flights
      .filter((flight) => {
        const icao = flight.icao24.toLowerCase();
        const callsign = (flight.callsign ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "");
        return icao.includes(compactQuery) || callsign.includes(compactQuery);
      })
      .slice(0, 12);
  }, [flights, compactQuery]);

  const hasResults =
    featured.length > 0 || airports.length > 0 || flightMatches.length > 0;

  async function runLookup(enterFpv = false) {
    if (!query.trim() || lookupBusy) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
      const found = await onLookupFlight(query, enterFpv);
      if (!found) {
        setLookupError(
          isIcao24Query
            ? "Flight not found for this ICAO24 right now"
            : "No live worldwide flight match found (or rate-limited)",
        );
      }
    } finally {
      setLookupBusy(false);
    }
  }

  async function openFlight(icao24: string, enterFpv = false) {
    if (lookupBusy) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
      const found = await onLookupFlight(icao24, enterFpv);
      if (!found) {
        setLookupError("Unable to open the selected flight");
      }
    } finally {
      setLookupBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-white/6 mx-5 pb-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-white/25" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLookupError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runLookup(false);
            }
          }}
          placeholder="Search airports or flight number (callsign/ICAO24)..."
          aria-label="Search airports by name, IATA code, city, country, or flight callsign/ICAO24"
          className="flex-1 bg-transparent text-[14px] font-medium text-white/90 placeholder:text-white/20 outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="shrink-0 text-white/20 hover:text-white/40 transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {compactQuery && (
            <div className="px-3 pb-2 space-y-2">
              <button
                type="button"
                onClick={() => void runLookup(false)}
                disabled={lookupBusy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[12px] font-medium text-white/75 transition-colors hover:bg-white/7 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                <span>Open Flight Details</span>
              </button>
              <button
                type="button"
                onClick={() => void runLookup(true)}
                disabled={lookupBusy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-[12px] font-medium text-sky-300/90 transition-colors hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                <span>Open in FPV</span>
              </button>
            </div>
          )}

          {lookupError && (
            <p className="px-3 pb-2 text-[11px] font-medium text-amber-300/85">
              {lookupError}
            </p>
          )}

          {flightMatches.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/15">
                Flights
              </p>
              {flightMatches.map((flight) => (
                <FlightRow
                  key={flight.icao24}
                  callsign={formatCallsign(flight.callsign)}
                  detail={`${flight.icao24.toUpperCase()} · ${flight.originCountry}`}
                  isActive={activeFlightIcao24 === flight.icao24}
                  onOpen={() => void openFlight(flight.icao24, false)}
                  onFpv={() => void openFlight(flight.icao24, true)}
                />
              ))}
            </>
          )}

          {!hasResults && (
            <p className="py-8 text-center text-[12px] text-white/25">
              No airports or flights found
            </p>
          )}

          {featured.length > 0 && (
            <>
              {query && (
                <p className="px-3 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/15">
                  Featured
                </p>
              )}
              {featured.map((city) => (
                <LocationRow
                  key={city.id}
                  name={city.name}
                  detail={`${city.iata} · ${city.country}`}
                  isActive={activeCity?.id === city.id}
                  onClick={() => onSelect(city)}
                />
              ))}
            </>
          )}

          {airports.length > 0 && (
            <>
              <p
                className={`px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/15 ${
                  featured.length > 0 ? "pt-3" : "pt-2"
                }`}
              >
                Airports
              </p>
              {airports.map((airport) => (
                <LocationRow
                  key={airport.iata}
                  name={airport.name}
                  detail={`${airport.iata} · ${airport.city}, ${airport.country}`}
                  isActive={activeCity?.iata === airport.iata}
                  onClick={() => onSelect(airportToCity(airport))}
                />
              ))}
            </>
          )}

          {!query && (
            <p className="px-3 pt-3 pb-1 text-center text-[10px] font-medium text-white/10">
              Search 9,000+ airports worldwide
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function LocationRow({
  name,
  detail,
  isActive,
  onClick,
}: {
  name: string;
  detail: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/4 ${
        isActive ? "bg-white/6" : ""
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/4">
        <MapPin className="h-3.5 w-3.5 text-white/40" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-[14px] font-medium text-white/80">{name}</p>
        <p className="text-[11px] font-medium text-white/25">{detail}</p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/12 transition-colors group-hover:text-white/25" />
    </button>
  );
}

function FlightRow({
  callsign,
  detail,
  isActive,
  onOpen,
  onFpv,
}: {
  callsign: string;
  detail: string;
  isActive: boolean;
  onOpen: () => void;
  onFpv: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/4 ${
        isActive ? "bg-white/6" : ""
      }`}
    >
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/4">
          <Plane className="h-3.5 w-3.5 text-white/40" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-white/80">
            {callsign}
          </p>
          <p className="text-[11px] font-medium text-white/25">{detail}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={onFpv}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-300/90 transition-colors hover:bg-sky-500/20"
        aria-label="Open flight in FPV"
      >
        <Eye className="h-3 w-3" />
        FPV
      </button>
    </div>
  );
}

"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Command } from "cmdk";
import {
  Search,
  X,
  Loader2,
  Gauge,
  ArrowUpRight,
  Globe2,
  MapPin,
  Plane,
} from "lucide-react";
import { motion } from "motion/react";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import {
  formatCallsign,
  altitudeToColor,
  headingToCardinal,
} from "@/lib/flight-utils";
import { useSettings } from "@/hooks/use-settings";
import { formatAltitude, formatSpeed } from "@/lib/unit-formatters";
import { lookupAirline, flightQueryMatches } from "@/lib/airlines";
import { CountryFlag } from "@/components/ui/country-flag";
import { AirlineLogo } from "@/components/ui/airline-logo";
import { searchFlightsGlobal } from "@/lib/search-flight-client";
import {
  searchLocalLocations,
  searchGeocode,
  locationToCity,
  type SearchLocation,
} from "@/lib/search-location-client";

// ── Highlight matched text safely ──────────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;

  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <span className="text-foreground/90 font-medium">
        {text.slice(idx, idx + q.length)}
      </span>
      {text.slice(idx + q.length)}
    </>
  );
}

// ── Altitude color dot ─────────────────────────────────────────────────

function AltitudeDot({ altitude }: { altitude: number | null }) {
  const [r, g, b] = altitudeToColor(altitude);
  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: `rgb(${r},${g},${b})` }}
      aria-label={
        altitude != null
          ? `Altitude: ${Math.round(altitude)}m`
          : "Unknown altitude"
      }
    />
  );
}

// ── Segmented Control (Apple-style) ────────────────────────────────────

function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: typeof MapPin }[];
}) {
  return (
    <div className="relative flex items-center rounded-xl bg-foreground/[0.04] p-1">
      {options.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-medium transition-colors duration-200 ${
              active
                ? "text-foreground/90"
                : "text-foreground/50 hover:text-foreground/70"
            }`}
            aria-pressed={active}
          >
            {active && (
              <motion.div
                layoutId="search-segment-bg"
                className="absolute inset-0 rounded-lg bg-popover shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-foreground/5"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────

type SearchMode = "locations" | "flights";

// ── Main SearchContent ─────────────────────────────────────────────────

export function SearchContent({
  activeCity,
  onSelect,
  flights,
  activeFlightIcao24,
  onLookupFlight,
  onSelectFlight,
}: {
  activeCity: City;
  onSelect: (city: City) => void;
  flights: FlightState[];
  activeFlightIcao24: string | null;
  onLookupFlight: (query: string, enterFpv?: boolean) => Promise<boolean>;
  onSelectFlight?: (flight: FlightState) => void;
}) {
  const { settings } = useSettings();
  const [mode, setMode] = useState<SearchMode>("locations");
  const [query, setQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Async location state
  const [geoResults, setGeoResults] = useState<SearchLocation[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const geoAbortRef = useRef<AbortController | null>(null);

  // Async flight state
  const [globalFlights, setGlobalFlights] = useState<FlightState[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const flightAbortRef = useRef<AbortController | null>(null);

  // Auto-focus with a frame delay for dialog mounting, re-focus on mode switch
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [mode]);

  // ── Debounced geocode search (Locations mode) ──────────────────────

  useEffect(() => {
    if (mode !== "locations") return;

    const q = query.trim();
    if (q.length < 2) return;

    geoAbortRef.current?.abort();
    const controller = new AbortController();
    geoAbortRef.current = controller;

    const timer = setTimeout(async () => {
      setGeoLoading(true);
      try {
        const results = await searchGeocode(q, controller.signal);
        if (!controller.signal.aborted) setGeoResults(results);
      } catch {
        if (!controller.signal.aborted) setGeoResults([]);
      } finally {
        if (!controller.signal.aborted) setGeoLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, mode]);

  // ── Debounced global flight search (Flights mode) ──────────────────

  useEffect(() => {
    if (mode !== "flights") return;

    const q = query.trim();
    if (q.length < 2) return;

    flightAbortRef.current?.abort();
    const controller = new AbortController();
    flightAbortRef.current = controller;

    const timer = setTimeout(async () => {
      setGlobalLoading(true);
      try {
        const results = await searchFlightsGlobal(q, controller.signal);
        if (!controller.signal.aborted) setGlobalFlights(results);
      } catch {
        if (!controller.signal.aborted) setGlobalFlights([]);
      } finally {
        if (!controller.signal.aborted) setGlobalLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, mode]);

  // ── Local results ──────────────────────────────────────────────────

  const localLocations = useMemo(
    () => searchLocalLocations(query),
    [query],
  );

  const compactQuery = query.trim().toLowerCase().replace(/\s+/g, "");
  const isPureHexQuery = /^[0-9a-f]{6}$/.test(compactQuery);
  const looksLikeFlightNumber = /^[a-z0-9]{2,3}\d+[a-z]?$/i.test(query.trim());

  const localFlightMatches = useMemo(() => {
    if (!compactQuery || mode !== "flights") return [] as FlightState[];
    return flights
      .filter((flight) => {
        const icao = flight.icao24.toLowerCase();
        // Direct hex or callsign match
        if (icao.includes(compactQuery)) return true;
        // IATA ↔ ICAO translated match
        if (flightQueryMatches(query, flight.callsign)) return true;
        return false;
      })
      .slice(0, 10);
  }, [flights, compactQuery, mode, query]);

  // Total result count for screen reader
  const totalResults =
    mode === "locations"
      ? localLocations.cities.length +
        localLocations.airports.length +
        geoResults.length
      : globalFlights.length + localFlightMatches.length;

  // ── Actions ────────────────────────────────────────────────────────

  const runLookup = useCallback(async () => {
    if (!query.trim() || lookupBusy) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
      // Prefer using an already-found ICAO24 so we avoid re-querying with a
      // raw string that might be misclassified (e.g. "IX2680" looks like hex).
      const target =
        globalFlights[0]?.icao24 ?? localFlightMatches[0]?.icao24 ?? query;
      const found = await onLookupFlight(target);
      if (!found) {
        if (isPureHexQuery) {
          setLookupError(
            `No flight found for ICAO24 ${query.trim().toUpperCase()} right now`,
          );
        } else if (looksLikeFlightNumber) {
          setLookupError(
            `No live flight match found for ${query.trim().toUpperCase()} right now. The aircraft may be on the ground or out of coverage.`,
          );
        } else {
          setLookupError(
            'No live flight match found — try a callsign like "UAL123" or hex like "a1b2c3"',
          );
        }
      }
    } finally {
      setLookupBusy(false);
    }
  }, [
    query,
    lookupBusy,
    onLookupFlight,
    isPureHexQuery,
    looksLikeFlightNumber,
    globalFlights,
    localFlightMatches,
  ]);

  const openFlight = useCallback(
    async (icao24: string) => {
      if (lookupBusy) return;

      // If we already have the flight data from global or local search,
      // select it directly without re-querying the API.
      const known =
        globalFlights.find((f) => f.icao24 === icao24) ??
        localFlightMatches.find((f) => f.icao24 === icao24);
      if (known && onSelectFlight) {
        onSelectFlight(known);
        return;
      }

      setLookupBusy(true);
      setLookupError(null);
      try {
        const found = await onLookupFlight(icao24);
        if (!found) setLookupError("Unable to open the selected flight");
      } finally {
        setLookupBusy(false);
      }
    },
    [lookupBusy, onLookupFlight, onSelectFlight, globalFlights, localFlightMatches],
  );

  const handleModeChange = useCallback((newMode: SearchMode) => {
    setMode(newMode);
    setLookupError(null);
    if (newMode === "locations") {
      setGlobalFlights([]);
      setGlobalLoading(false);
    } else {
      setGeoResults([]);
      setGeoLoading(false);
    }
  }, []);

  // ── Custom cmdk filter ─────────────────────────────────────────────

  const cmdkFilter = useCallback(
    (value: string, search: string, keywords?: string[]) => {
      if (!search) return 1;
      const s = search.toLowerCase().replace(/\s+/g, "");
      const v = value.toLowerCase();
      const kw = keywords ? keywords.join(" ").toLowerCase() : "";
      const combined = `${v} ${kw}`;

      if (v === s) return 1;
      if (v.startsWith(s)) return 0.95;
      if (kw && kw.startsWith(s)) return 0.9;
      const words = combined.split(/[\s·,]+/);
      for (const w of words) {
        if (w.startsWith(s)) return 0.8;
      }
      if (combined.includes(s)) return 0.6;
      return 0;
    },
    [],
  );

  // ── Render helpers ─────────────────────────────────────────────────

  const flightItem = (flight: FlightState, isGlobal = false) => {
    const cs = formatCallsign(flight.callsign);
    const airline = lookupAirline(flight.callsign);
    return (
      <Command.Item
        key={flight.icao24}
        value={`flight:${flight.icao24}:${cs}:${isGlobal ? "global" : "local"}`}
        keywords={[flight.icao24, cs, flight.originCountry]}
        onSelect={() => void openFlight(flight.icao24)}
        className="search-item"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
          <AirlineLogo
            callsign={flight.callsign}
            airlineName={airline}
            size={22}
            className="shrink-0"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] font-medium text-foreground/90">
              <HighlightMatch text={cs} query={query} />
            </p>
            {activeFlightIcao24 === flight.icao24 && (
              <span className="shrink-0 rounded-full bg-emerald-500/12 border border-emerald-400/18 px-2 py-0.5 text-[10px] font-semibold text-emerald-400/80">
                Active
              </span>
            )}
            {isGlobal && (
              <span className="shrink-0 rounded-full bg-sky-500/10 border border-sky-400/15 px-2 py-0.5 text-[10px] font-semibold text-sky-400/70">
                Global
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[12px] text-foreground/50 mt-0.5">
            <span className="font-mono tracking-wide">
              <HighlightMatch
                text={flight.icao24.toUpperCase()}
                query={query}
              />
            </span>
            <span className="text-foreground/25">·</span>
            <CountryFlag
              country={flight.originCountry}
              size={11}
              className="rounded-[1px]"
            />
            <span className="truncate">{flight.originCountry}</span>
          </div>
        </div>

        {/* Flight info chips */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {flight.baroAltitude != null && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.04] px-2 py-1 text-[11px] font-medium text-foreground/50">
              <AltitudeDot altitude={flight.baroAltitude} />
              {formatAltitude(flight.baroAltitude, settings.unitSystem)}
            </span>
          )}
          {flight.velocity != null && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.04] px-2 py-1 text-[11px] font-medium text-foreground/50">
              <Gauge className="h-3 w-3 text-foreground/35" />
              {formatSpeed(flight.velocity, settings.unitSystem)}
            </span>
          )}
          {flight.trueTrack != null && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.04] px-2 py-1 text-[11px] font-medium text-foreground/50">
              <ArrowUpRight
                className="h-3 w-3 text-foreground/35"
                style={{
                  transform: `rotate(${flight.trueTrack - 45}deg)`,
                }}
              />
              {headingToCardinal(flight.trueTrack)}
            </span>
          )}
        </div>
      </Command.Item>
    );
  };

  return (
    <Command
      className="flex h-full flex-col aeris-cmdk"
      filter={cmdkFilter}
      loop
      label={
        mode === "locations"
          ? "Search airports, cities, and places"
          : "Search live flights worldwide"
      }
    >
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 space-y-4">
        {/* Segmented control */}
        <SegmentedControl
          value={mode}
          onChange={(v) => handleModeChange(v as SearchMode)}
          options={[
            { value: "locations", label: "Locations", icon: MapPin },
            { value: "flights", label: "Flights", icon: Plane },
          ]}
        />

        {/* Search input */}
        <div className="flex items-center gap-3 rounded-2xl bg-foreground/[0.035] border border-foreground/[0.06] px-4 py-3.5 transition-colors focus-within:bg-foreground/[0.05] focus-within:border-foreground/[0.12]">
          <Search className="h-[18px] w-[18px] shrink-0 text-foreground/25" />
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setLookupError(null);
              const trimmed = v.trim();
              if (!trimmed || trimmed.length < 2) {
                setGeoResults([]);
                setGlobalFlights([]);
                setGeoLoading(false);
                setGlobalLoading(false);
              }
            }}

            placeholder={
              mode === "locations"
                ? "Search airports, cities, places…"
                : "Search flights by callsign or ICAO24…"
            }
            aria-label={
              mode === "locations"
                ? "Search airports, cities, and places"
                : "Search live flights by callsign or ICAO24"
            }
            className="flex-1 bg-transparent text-[15px] font-normal text-foreground/85 placeholder:text-foreground/25 outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/10 text-foreground/30 hover:bg-foreground/15 hover:text-foreground/50 transition-all"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────────── */}
      {lookupError && (
        <div className="mx-5 mb-3 flex items-start gap-3 rounded-xl border border-amber-500/12 bg-amber-500/[0.04] px-4 py-3">
          <span className="text-[13px] font-normal text-amber-400/70 leading-snug">
            {lookupError}
          </span>
        </div>
      )}

      {/* ── Result list ───────────────────────────────────────────── */}
      <Command.List className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none px-3 pb-4">
        <Command.Empty className="flex flex-col items-center justify-center py-16 gap-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-foreground/[0.04]">
            <Globe2 className="h-6 w-6 text-foreground/25" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-[15px] font-medium text-foreground/55">
              No results found
            </p>
            <p className="text-[13px] text-foreground/35 max-w-[220px] leading-relaxed">
              {mode === "locations"
                ? "Try an airport code, city name, or landmark"
                : "Try a callsign like UAL123 or hex like a1b2c3"}
            </p>
          </div>
        </Command.Empty>

        {mode === "locations" ? (
          <>
            {/* ── Loading: Places ─────────────────────────────── */}
            {geoLoading && (
              <Command.Group heading="Places">
                <Command.Item
                  value="__geo-loading__"
                  disabled
                  className="search-item opacity-50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-foreground/35" />
                  </div>
                  <span className="text-[14px] font-normal text-foreground/55">
                    Searching places worldwide…
                  </span>
                </Command.Item>
              </Command.Group>
            )}

            {/* ── Cities ──────────────────────────────────────── */}
            {localLocations.cities.length > 0 && (
              <Command.Group
                heading={query ? "Cities" : "Popular Airports"}
              >
                {localLocations.cities.map((loc) => (
                  <Command.Item
                    key={loc.id}
                    value={loc.id}
                    keywords={[loc.name, loc.code, loc.countryCode]}
                    onSelect={() => onSelect(locationToCity(loc))}
                    className="search-item"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                      <CountryFlag
                        code={loc.countryCode}
                        size={18}
                        className="shrink-0 rounded-[4px]"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[14px] font-normal text-foreground/85">
                        <HighlightMatch text={loc.name} query={query} />
                      </p>
                      <p className="flex items-center gap-2 text-[12px] text-foreground/40 mt-0.5">
                        <HighlightMatch text={loc.code} query={query} />
                        <span className="text-foreground/20">·</span>
                        <CountryFlag
                          code={loc.countryCode}
                          size={11}
                          className="inline-block rounded-[2px]"
                        />
                      </p>
                    </div>
                    {activeCity?.id === loc.id && (
                      <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[10px] font-semibold text-foreground/35">
                        Current
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* ── Airports ────────────────────────────────────── */}
            {localLocations.airports.length > 0 && (
              <Command.Group heading="Airports">
                {localLocations.airports.map((loc) => (
                  <Command.Item
                    key={loc.id}
                    value={loc.id}
                    keywords={[
                      loc.code,
                      loc.name,
                      loc.countryCode,
                      loc.displayName,
                    ]}
                    onSelect={() => onSelect(locationToCity(loc))}
                    className="search-item"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                      <CountryFlag
                        code={loc.countryCode}
                        size={18}
                        className="shrink-0 rounded-[4px]"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[14px] font-normal text-foreground/85">
                        <HighlightMatch text={loc.name} query={query} />
                      </p>
                      <p className="flex items-center gap-2 text-[12px] text-foreground/40 mt-0.5">
                        <HighlightMatch text={loc.code} query={query} />
                        <span className="text-foreground/20">·</span>
                        <span className="truncate">
                          <HighlightMatch
                            text={loc.displayName
                              .replace(loc.name, "")
                              .replace(/^ — /, "")}
                            query={query}
                          />
                        </span>
                      </p>
                    </div>
                    {activeCity?.iata === loc.code && (
                      <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[10px] font-semibold text-foreground/35">
                        Current
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* ── Places (Nominatim) ──────────────────────────── */}
            {geoResults.length > 0 && (
              <Command.Group heading="Places">
                {geoResults.map((loc) => (
                  <Command.Item
                    key={loc.id}
                    value={loc.id}
                    keywords={[
                      loc.name,
                      loc.displayName,
                      loc.countryCode,
                    ]}
                    onSelect={() => onSelect(locationToCity(loc))}
                    className="search-item"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04]">
                      <Globe2 className="h-[18px] w-[18px] text-foreground/35" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[14px] font-normal text-foreground/85">
                        <HighlightMatch text={loc.name} query={query} />
                      </p>
                      <p className="truncate text-[12px] text-foreground/40 mt-0.5">
                        {loc.displayName}
                      </p>
                    </div>
                    {loc.countryCode && (
                      <CountryFlag
                        code={loc.countryCode}
                        size={16}
                        className="shrink-0 rounded-[3px]"
                      />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </>
        ) : (
          <>
            {/* ── Actions ─────────────────────────────────────── */}
            {compactQuery &&
              !globalLoading &&
              globalFlights.length === 0 &&
              localFlightMatches.length === 0 && (
                <Command.Group heading="Actions">
                  <Command.Item
                    value={`lookup:${query}`}
                    keywords={[query]}
                    onSelect={() => void runLookup()}
                    disabled={lookupBusy}
                    className="search-item"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05]">
                      {lookupBusy ? (
                        <Loader2 className="h-[18px] w-[18px] animate-spin text-foreground/35" />
                      ) : (
                        <Search className="h-[18px] w-[18px] text-foreground/35" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[14px] font-normal text-foreground/85">
                        Search worldwide for &quot;{query.trim()}&quot;
                      </p>
                      <p className="text-[12px] text-foreground/40 mt-0.5">
                        {isPureHexQuery
                          ? "ICAO24 hex lookup"
                          : "Callsign / flight number lookup"}
                      </p>
                    </div>
                  </Command.Item>
                </Command.Group>
              )}

            {/* ── Global flight results ───────────────────────── */}
            {globalLoading && (
              <Command.Group heading="Live Flights">
                <Command.Item
                  value="__flight-loading__"
                  disabled
                  className="search-item opacity-50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-foreground/35" />
                  </div>
                  <span className="text-[14px] font-normal text-foreground/55">
                    Searching live flights worldwide…
                  </span>
                </Command.Item>
              </Command.Group>
            )}

            {!globalLoading && globalFlights.length > 0 && (
              <Command.Group heading="Live Flights">
                {globalFlights.map((flight) => flightItem(flight, true))}
              </Command.Group>
            )}

            {/* ── Nearby local flights ────────────────────────── */}
            {!globalLoading &&
              globalFlights.length === 0 &&
              localFlightMatches.length > 0 && (
                <Command.Group heading="Nearby">
                  {localFlightMatches.map((flight) =>
                    flightItem(flight, false),
                  )}
                </Command.Group>
              )}
          </>
        )}

        {/* ── SR-only result count ──────────────────────────────── */}
        <div className="sr-only" aria-live="polite" role="status">
          {query
            ? `${totalResults} result${totalResults !== 1 ? "s" : ""} found`
            : mode === "locations"
              ? "Search 9,000+ airports and places worldwide"
              : "Search live flights globally by callsign or hex"}
        </div>

        {/* ── Footer hint ───────────────────────────────────────── */}
        {!query && (
          <div className="flex items-center justify-center py-8">
            <p className="text-[12px] text-foreground/25 font-normal">
              {mode === "locations"
                ? "Search 9,000+ airports and places worldwide"
                : "Search live flights globally by callsign or hex"}
            </p>
          </div>
        )}
      </Command.List>
    </Command>
  );
}

"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Command } from "cmdk";
import {
  Search,
  X,
  MapPin,
  Plane,
  Eye,
  Loader2,
  Clock,
  Trash2,
  Gauge,
  ArrowUpRight,
  Globe2,
} from "lucide-react";
import { CITIES, type City } from "@/lib/cities";
import { searchAirports, airportToCity } from "@/lib/airports";
import type { FlightState } from "@/lib/opensky";
import {
  formatCallsign,
  altitudeToColor,
  headingToCardinal,
} from "@/lib/flight-utils";
import { useSettings } from "@/hooks/use-settings";
import { formatAltitude, formatSpeed } from "@/lib/unit-formatters";

// ── Recent searches (localStorage) ─────────────────────────────────────

const RECENT_KEY = "aeris:recent-searches";
const RECENT_MAX = 4;
const RECENT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type RecentEntry = { q: string; ts: number };

function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const valid = parsed
      .filter(
        (e): e is RecentEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof e.q === "string" &&
          typeof e.ts === "number" &&
          now - e.ts < RECENT_EXPIRY_MS,
      )
      .slice(0, RECENT_MAX);
    if (valid.length !== parsed.length) {
      localStorage.setItem(RECENT_KEY, JSON.stringify(valid));
    }
    return valid.map((e) => e.q);
  } catch {
    // localStorage unavailable or corrupted — return empty recent list
    return [];
  }
}

function addRecent(query: string) {
  const q = query.trim();
  if (!q || q.length > 100) return;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const prev: RecentEntry[] = raw ? (JSON.parse(raw) ?? []) : [];
    const filtered = (Array.isArray(prev) ? prev : []).filter(
      (e): e is RecentEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.q === "string" &&
        e.q.toLowerCase() !== q.toLowerCase(),
    );
    const next = [{ q, ts: Date.now() }, ...filtered].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable or quota exceeded
  }
}

function removeRecent(query: string) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const prev: RecentEntry[] = raw ? (JSON.parse(raw) ?? []) : [];
    const next = (Array.isArray(prev) ? prev : []).filter(
      (e): e is RecentEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.q === "string" &&
        e.q.toLowerCase() !== query.toLowerCase(),
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable or corrupted
  }
}

function clearRecents() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // localStorage unavailable
  }
}

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
      <span className="text-foreground/95 font-semibold">
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

// ── Country code to flag emoji ─────────────────────────────────────────

function countryFlag(countryName: string): string {
  const COUNTRY_ISO: Record<string, string> = {
    "united states": "US",
    usa: "US",
    us: "US",
    "united kingdom": "GB",
    uk: "GB",
    gb: "GB",
    germany: "DE",
    france: "FR",
    spain: "ES",
    italy: "IT",
    canada: "CA",
    australia: "AU",
    japan: "JP",
    china: "CN",
    india: "IN",
    brazil: "BR",
    russia: "RU",
    mexico: "MX",
    "south korea": "KR",
    netherlands: "NL",
    switzerland: "CH",
    sweden: "SE",
    norway: "NO",
    denmark: "DK",
    ireland: "IE",
    portugal: "PT",
    austria: "AT",
    belgium: "BE",
    turkey: "TR",
    thailand: "TH",
    singapore: "SG",
    malaysia: "MY",
    indonesia: "ID",
    philippines: "PH",
    "united arab emirates": "AE",
    "saudi arabia": "SA",
    qatar: "QA",
    israel: "IL",
    "south africa": "ZA",
    egypt: "EG",
    "new zealand": "NZ",
    argentina: "AR",
    chile: "CL",
    colombia: "CO",
    peru: "PE",
    poland: "PL",
    czechia: "CZ",
    "czech republic": "CZ",
    romania: "RO",
    greece: "GR",
    finland: "FI",
    vietnam: "VN",
    taiwan: "TW",
    "hong kong": "HK",
    pakistan: "PK",
    bangladesh: "BD",
    ukraine: "UA",
    hungary: "HU",
    morocco: "MA",
    nigeria: "NG",
    kenya: "KE",
    iceland: "IS",
    luxembourg: "LU",
    croatia: "HR",
    serbia: "RS",
    bulgaria: "BG",
    slovakia: "SK",
    slovenia: "SI",
    estonia: "EE",
    latvia: "LV",
    lithuania: "LT",
    malta: "MT",
    cyprus: "CY",
  };

  const key = countryName.trim().toLowerCase();
  const iso = COUNTRY_ISO[key];
  if (!iso) return "";

  // Convert ISO code to flag emoji using regional indicator symbols
  return String.fromCodePoint(
    ...iso.split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

// ── Main SearchContent ─────────────────────────────────────────────────

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
  const { settings } = useSettings();
  const [query, setQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load recents on mount
  useEffect(() => {
    setRecents(getRecents());
  }, []);

  // Auto-focus with a frame delay for dialog mounting
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Live search results
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

  const compactQuery = query.trim().toLowerCase().replace(/\s+/g, "");
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
      .slice(0, 15);
  }, [flights, compactQuery]);

  const showRecents = !query && recents.length > 0;

  // Total result count for screen reader
  const totalResults = flightMatches.length + featured.length + airports.length;

  // ── Actions ────────────────────────────────────────────────────────

  const runLookup = useCallback(
    async (enterFpv = false) => {
      if (!query.trim() || lookupBusy) return;
      setLookupBusy(true);
      setLookupError(null);
      addRecent(query.trim());
      setRecents(getRecents());
      try {
        const found = await onLookupFlight(query, enterFpv);
        if (!found) {
          setLookupError(
            isIcao24Query
              ? "Flight not found for this ICAO24 right now"
              : 'No live flight match found — try a callsign like "UAL123" or ICAO24 hex',
          );
        }
      } finally {
        setLookupBusy(false);
      }
    },
    [query, lookupBusy, onLookupFlight, isIcao24Query],
  );

  const openFlight = useCallback(
    async (icao24: string, enterFpv = false) => {
      if (lookupBusy) return;
      setLookupBusy(true);
      setLookupError(null);
      addRecent(icao24.toUpperCase());
      setRecents(getRecents());
      try {
        const found = await onLookupFlight(icao24, enterFpv);
        if (!found) setLookupError("Unable to open the selected flight");
      } finally {
        setLookupBusy(false);
      }
    },
    [lookupBusy, onLookupFlight],
  );

  const handleRemoveRecent = useCallback((q: string) => {
    removeRecent(q);
    setRecents(getRecents());
  }, []);

  const handleClearRecents = useCallback(() => {
    clearRecents();
    setRecents([]);
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

  return (
    <Command
      className="flex h-full flex-col aeris-cmdk"
      filter={cmdkFilter}
      loop
      label="Search airports, flights, and cities"
    >
      {/* ── Search input ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 border-b border-foreground/6 mx-3 sm:mx-5 pb-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-foreground/25" />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            setLookupError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void runLookup(true);
            }
          }}
          placeholder="Search airports, flights, ICAO24…"
          aria-label="Search airports, flights, and cities"
          className="flex-1 bg-transparent text-[14px] font-medium text-foreground/90 placeholder:text-foreground/20 outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="shrink-0 text-foreground/20 hover:text-foreground/40 transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Error banner ──────────────────────────────────────────── */}
      {lookupError && (
        <div className="mx-3 sm:mx-5 mt-2 flex items-start gap-2 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2">
          <span className="mt-px text-[11px] font-medium text-amber-300/85 leading-snug">
            {lookupError}
          </span>
        </div>
      )}

      {/* ── Result list ───────────────────────────────────────────── */}
      <Command.List
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none p-2"
      >
        <Command.Empty className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/4">
            <Globe2 className="h-5 w-5 text-foreground/15" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-[13px] font-medium text-foreground/30">
              No results found
            </p>
            <p className="text-[11px] text-foreground/15 max-w-55 leading-relaxed">
              Try an airport code like &quot;JFK&quot;, a city name, or a flight
              callsign like &quot;UAL123&quot;
            </p>
          </div>
        </Command.Empty>

        {/* ── Recent searches ───────────────────────────────────── */}
        {showRecents && (
          <Command.Group
            heading={
              <div className="flex items-center justify-between">
                <span>Recent</span>
                <button
                  onClick={handleClearRecents}
                  className="text-[9px] font-medium text-foreground/20 hover:text-foreground/40 transition-colors normal-case tracking-normal"
                >
                  Clear all
                </button>
              </div>
            }
          >
            {recents.map((r) => (
              <Command.Item
                key={`recent-${r}`}
                value={`recent:${r}`}
                keywords={[r]}
                onSelect={() => {
                  setQuery(r);
                  inputRef.current?.focus();
                }}
                className="search-item"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/3">
                  <Clock className="h-3 w-3 text-foreground/25" />
                </div>
                <span className="flex-1 truncate text-[13px] font-medium text-foreground/50">
                  {r}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveRecent(r);
                  }}
                  className="shrink-0 opacity-0 group-data-[selected=true]/item:opacity-100 text-foreground/20 hover:text-foreground/40 transition-all"
                  aria-label={`Remove ${r} from recent searches`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* ── Worldwide lookup action ───────────────────────────── */}
        {compactQuery && (
          <Command.Group heading="Actions">
            <Command.Item
              value={`lookup:${query}`}
              keywords={[query]}
              onSelect={() => void runLookup(false)}
              disabled={lookupBusy}
              className="search-item"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/4">
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/40" />
                ) : (
                  <Search className="h-3.5 w-3.5 text-foreground/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[13px] font-medium text-foreground/70">
                  Search worldwide for &quot;{query.trim()}&quot;
                </p>
                <p className="text-[10px] text-foreground/25">
                  {isIcao24Query
                    ? "ICAO24 hex lookup"
                    : "Callsign / flight number lookup"}
                </p>
              </div>
              <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-foreground/8 bg-foreground/4 px-1.5 text-[9px] font-semibold text-foreground/25">
                ↵
              </kbd>
            </Command.Item>
            <Command.Item
              value={`fpv:${query}`}
              keywords={[query, "fpv", "first person"]}
              onSelect={() => void runLookup(true)}
              disabled={lookupBusy}
              className="search-item"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-400/15">
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300/60" />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-sky-300/70" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[13px] font-medium text-sky-200/70">
                  Open in FPV mode
                </p>
                <p className="text-[10px] text-sky-300/25">
                  Follow camera view
                </p>
              </div>
              <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-foreground/8 bg-foreground/4 px-1.5 text-[9px] font-semibold text-foreground/25">
                <span className="text-[8px]">⌘</span>↵
              </kbd>
            </Command.Item>
          </Command.Group>
        )}

        {/* ── Live flights ──────────────────────────────────────── */}
        {flightMatches.length > 0 && (
          <Command.Group heading="Live Flights">
            {flightMatches.map((flight) => {
              const cs = formatCallsign(flight.callsign);
              const flag = countryFlag(flight.originCountry);
              return (
                <Command.Item
                  key={flight.icao24}
                  value={`flight:${flight.icao24}:${cs}`}
                  keywords={[flight.icao24, cs, flight.originCountry]}
                  onSelect={() => void openFlight(flight.icao24, false)}
                  className="search-item"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/4">
                    <Plane className="h-3.5 w-3.5 text-foreground/40" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-semibold text-foreground/80">
                        <HighlightMatch text={cs} query={query} />
                      </p>
                      {activeFlightIcao24 === flight.icao24 && (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 border border-emerald-400/20 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-emerald-300/80">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-foreground/25">
                      <span className="font-mono">
                        <HighlightMatch
                          text={flight.icao24.toUpperCase()}
                          query={query}
                        />
                      </span>
                      <span className="text-foreground/10">·</span>
                      {flag && <span className="text-[10px]">{flag}</span>}
                      <span>{flight.originCountry}</span>
                    </div>
                  </div>

                  {/* Flight info chips */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {flight.baroAltitude != null && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-foreground/3 px-1.5 py-0.5 text-[9px] font-medium text-foreground/30">
                        <AltitudeDot altitude={flight.baroAltitude} />
                        {formatAltitude(flight.baroAltitude, settings.unitSystem)}
                      </span>
                    )}
                    {flight.velocity != null && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-foreground/3 px-1.5 py-0.5 text-[9px] font-medium text-foreground/30">
                        <Gauge className="h-2.5 w-2.5 text-foreground/20" />
                        {formatSpeed(flight.velocity, settings.unitSystem)}
                      </span>
                    )}
                    {flight.trueTrack != null && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-foreground/3 px-1.5 py-0.5 text-[9px] font-medium text-foreground/30">
                        <ArrowUpRight
                          className="h-2.5 w-2.5 text-foreground/20"
                          style={{
                            transform: `rotate(${flight.trueTrack - 45}deg)`,
                          }}
                        />
                        {headingToCardinal(flight.trueTrack)}
                      </span>
                    )}
                  </div>

                  {/* FPV button — visible on hover/keyboard-select */}
                  {!flight.onGround && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openFlight(flight.icao24, true);
                      }}
                      className="shrink-0 opacity-0 group-data-[selected=true]/item:opacity-100 inline-flex h-6 items-center gap-1 rounded-md border border-sky-400/20 bg-sky-500/10 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300/80 transition-all hover:bg-sky-500/20"
                      aria-label={`Open ${cs} in FPV`}
                    >
                      <Eye className="h-2.5 w-2.5" />
                      FPV
                    </button>
                  )}
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

        {/* ── Featured cities ───────────────────────────────────── */}
        {featured.length > 0 && (
          <Command.Group
            heading={query ? "Featured Cities" : "Popular Airports"}
          >
            {featured.map((city) => (
              <Command.Item
                key={city.id}
                value={`city:${city.id}:${city.name}`}
                keywords={[city.name, city.iata, city.country]}
                onSelect={() => onSelect(city)}
                className="search-item"
              >
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    activeCity?.id === city.id ? "bg-foreground/8" : "bg-foreground/4"
                  }`}
                >
                  <MapPin
                    className={`h-3.5 w-3.5 ${
                      activeCity?.id === city.id
                        ? "text-foreground/60"
                        : "text-foreground/35"
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground/80">
                    <HighlightMatch text={city.name} query={query} />
                  </p>
                  <p className="text-[10px] font-medium text-foreground/25">
                    <HighlightMatch text={city.iata} query={query} />
                    <span className="text-foreground/10"> · </span>
                    {city.country}
                  </p>
                </div>
                {activeCity?.id === city.id && (
                  <span className="shrink-0 rounded-full bg-foreground/6 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-foreground/30">
                    Current
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* ── Airport results ───────────────────────────────────── */}
        {airports.length > 0 && (
          <Command.Group heading="Airports">
            {airports.map((airport) => (
              <Command.Item
                key={airport.iata}
                value={`airport:${airport.iata}:${airport.name}`}
                keywords={[
                  airport.iata,
                  airport.city,
                  airport.country,
                  airport.name,
                ]}
                onSelect={() => onSelect(airportToCity(airport))}
                className="search-item"
              >
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    activeCity?.iata === airport.iata
                      ? "bg-foreground/8"
                      : "bg-foreground/4"
                  }`}
                >
                  <MapPin
                    className={`h-3.5 w-3.5 ${
                      activeCity?.iata === airport.iata
                        ? "text-foreground/60"
                        : "text-foreground/35"
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground/80">
                    <HighlightMatch text={airport.name} query={query} />
                  </p>
                  <p className="text-[10px] font-medium text-foreground/25">
                    <HighlightMatch text={airport.iata} query={query} />
                    <span className="text-foreground/10"> · </span>
                    <HighlightMatch text={airport.city} query={query} />,{" "}
                    {airport.country}
                  </p>
                </div>
                {activeCity?.iata === airport.iata && (
                  <span className="shrink-0 rounded-full bg-foreground/6 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-foreground/30">
                    Current
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* ── SR-only result count ──────────────────────────────── */}
        <div className="sr-only" aria-live="polite" role="status">
          {query
            ? `${totalResults} result${totalResults !== 1 ? "s" : ""} found`
            : `${CITIES.length} featured airports`}
        </div>

        {/* ── Footer hint ───────────────────────────────────────── */}
        {!query && !showRecents && (
          <div className="flex items-center justify-center gap-2 py-4">
            <p className="text-[10px] text-foreground/12 font-medium">
              Search 9,000+ airports worldwide
            </p>
          </div>
        )}
      </Command.List>
    </Command>
  );
}

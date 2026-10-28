"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "motion/react";
import { AudioLines, ChevronLeft, ChevronRight, Globe2, Search, X } from "lucide-react";
import { CountryFlag } from "@/components/ui/country-flag";
import type { AtcAirport, AtcCountry } from "./types";

const TowerMap = dynamic(() => import("./tower-map"), {
  ssr: false,
  loading: () => <div className="size-full rounded-lg bg-card" />,
});

const SPRING = { type: "spring", stiffness: 420, damping: 42, mass: 0.9 } as const;
/** Towers worth a first listen, shown before a country is picked. */
const FEATURED = ["KJFK", "KLAX", "KSFO", "EGLL", "EHAM", "RJTT", "YSSY", "CYYZ", "EIDW"];
const MAX_RESULTS = 60;

function Flag({ code, size = 16 }: { code: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden ring-1 ring-border" style={{ borderRadius: 3 }}>
      <CountryFlag code={code} size={size} />
    </span>
  );
}

function AirportRow({
  airport,
  current,
  live,
  onPick,
}: {
  airport: AtcAirport;
  current: boolean;
  live: boolean;
  onPick: (icao: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(airport.icao)}
        aria-current={current || undefined}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-card aria-[current]:bg-card"
      >
        <span className="w-12 shrink-0 text-value font-medium">{airport.iata}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{airport.city}</span>
          <span className="block truncate text-small text-muted-foreground">
            {airport.name}
          </span>
        </span>
        {current && live && <AudioLines className="size-4 shrink-0 text-tint" aria-label="Playing" />}
      </button>
    </li>
  );
}

/**
 * The tower picker, as a sheet that rests at the bottom and pulls up over
 * the map: search, every country by flag, and a map of every tower.
 */
export function TowerSheet({
  airports,
  countries,
  selected,
  live,
  open,
  dark,
  onOpenChange,
  onPick,
  onPeek,
}: {
  airports: AtcAirport[];
  countries: AtcCountry[];
  selected: string | null;
  live: boolean;
  open: boolean;
  dark: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (icao: string) => void;
  /** The height the sheet shows while resting, so the player can sit above it. */
  onPeek: (height: number) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controls = useDragControls();
  const y = useMotionValue(2000);
  const [rest, setRest] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [mapSeen, setMapSeen] = useState(false);
  if (open && !mapSeen) setMapSeen(true);
  // Closing the sheet puts the search away with it.
  if (!open && searching) {
    setSearching(false);
    setQuery("");
  }

  const startSearch = useCallback(() => {
    setSearching(true);
    onOpenChange(true);
  }, [onOpenChange]);
  const stopSearch = useCallback(() => {
    setSearching(false);
    setQuery("");
  }, []);

  // Resting offset = sheet height less its header, measured live.
  useEffect(() => {
    const sheet = sheetRef.current;
    const header = headerRef.current;
    if (!sheet || !header) return;
    const measure = () => {
      const peek = header.offsetHeight;
      setRest(Math.max(0, sheet.offsetHeight - peek));
      onPeek(peek);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    observer.observe(header);
    return () => observer.disconnect();
  }, [onPeek]);

  useEffect(() => {
    if (rest === null) return;
    const controls = animate(y, open ? 0 : rest, SPRING);
    return () => controls.stop();
  }, [open, rest, y]);

  // Escape backs out of search first, then closes; "/" opens search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        if (searching) stopSearch();
        else onOpenChange(false);
        return;
      }
      const target = event.target as HTMLElement;
      if (
        event.key === "/" &&
        !searching &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !target.isContentEditable &&
        !target.closest("input, textarea, select")
      ) {
        event.preventDefault();
        startSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, searching, onOpenChange, startSearch, stopSearch]);

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (rest === null) return;
      const next =
        info.velocity.y < -300 ? true : info.velocity.y > 300 ? false : y.get() < rest / 2;
      if (next === open) animate(y, open ? 0 : rest, SPRING);
      else onOpenChange(next);
    },
    [onOpenChange, open, rest, y],
  );

  const pickCountry = useCallback(
    (code: string | null) => {
      setCountry(code);
      setQuery("");
      onOpenChange(true);
    },
    [onOpenChange],
  );

  const byIcao = useMemo(() => new Map(airports.map((a) => [a.icao, a])), [airports]);
  const names = useMemo(() => new Map(countries.map((c) => [c.code, c.name])), [countries]);
  const countryName = country ? names.get(country) ?? country : null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return airports
      .filter(
        (a) =>
          a.iata.toLowerCase() === q ||
          a.icao.toLowerCase() === q ||
          a.city.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (names.get(a.country) ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => Number(b.iata.toLowerCase() === q) - Number(a.iata.toLowerCase() === q))
      .slice(0, MAX_RESULTS);
  }, [airports, names, query]);

  const inCountry = useMemo(
    () => (country ? airports.filter((a) => a.country === country) : []),
    [airports, country],
  );

  const featured = useMemo(
    () => FEATURED.map((icao) => byIcao.get(icao)).filter((a): a is AtcAirport => !!a),
    [byIcao],
  );

  const pick = (icao: string) => {
    onPick(icao);
    onOpenChange(false);
  };

  return (
    <>
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 z-20 bg-scrim"
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        style={{ pointerEvents: open ? "auto" : "none" }}
        onClick={() => onOpenChange(false)}
      />
      <motion.section
        ref={sheetRef}
        aria-label="Towers"
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: rest ?? 0 }}
        dragElastic={0.05}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        style={{ y }}
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex h-[min(84dvh,780px)] w-full flex-col rounded-t-xl bg-background shadow-lift sm:w-[min(calc(100%-32px),920px)]"
      >
        <div
          ref={headerRef}
          className="shrink-0 cursor-grab touch-none select-none px-4 pb-[max(8px,env(safe-area-inset-bottom))] active:cursor-grabbing"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("input, button")) return;
            controls.start(event);
          }}
        >
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            aria-label={open ? "Close towers" : "Open towers"}
            className="flex h-5 w-full items-center justify-center"
          >
            <span className="h-[5px] w-9 rounded-full bg-border" />
          </button>
          {searching && (
            <div className="flex h-[61px] items-center gap-3">
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md bg-card px-3">
                <Search className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                <input
                  ref={inputRef}
                  autoFocus
                  type="search"
                  enterKeyHint="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search towers"
                  aria-label="Search towers"
                  className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="flex size-5 items-center justify-center rounded-full bg-subtle text-background"
                  >
                    <X className="size-3" strokeWidth={2.5} />
                  </button>
                )}
              </label>
              <button
                type="button"
                onClick={stopSearch}
                className="shrink-0 text-body text-tint transition-opacity hover:opacity-80"
              >
                Cancel
              </button>
            </div>
          )}

          <div
            className={`scrollbar-none -mx-4 gap-0.5 overflow-x-auto px-3 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)] ${searching ? "hidden" : "flex"}`}
            role="group"
            aria-label="Countries"
          >
            <button
              type="button"
              onClick={startSearch}
              aria-label="Search towers"
              title="Search towers (/)"
              className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-md py-2 transition-colors hover:bg-card"
            >
              <span className="flex h-6 w-9 items-center justify-center rounded-sm bg-card ring-1 ring-border">
                <Search className="size-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="text-caption text-muted-foreground">Search</span>
            </button>
            <button
              type="button"
              onClick={() => pickCountry(null)}
              aria-pressed={open && country === null}
              className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-md py-2 transition-colors hover:bg-card aria-pressed:bg-card"
            >
              <span className="flex h-6 w-9 items-center justify-center rounded-sm bg-card ring-1 ring-border">
                <Globe2 className="size-4 text-muted-foreground" />
              </span>
              <span className="text-caption text-muted-foreground">All</span>
            </button>
            {countries.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => pickCountry(c.code)}
                aria-pressed={country === c.code}
                title={c.name}
                className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-md py-2 transition-colors hover:bg-card aria-pressed:bg-card"
              >
                <Flag code={c.code} size={24} />
                <span className="w-full truncate px-1 text-center text-caption text-muted-foreground">
                  {c.short}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[220px_minmax(0,1fr)] gap-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:grid-rows-1">
          <div className="min-h-0">
            {mapSeen && (
              <TowerMap
                airports={airports}
                selected={selected}
                country={country}
                dark={dark}
                onSelect={pick}
              />
            )}
          </div>

          <div className="scrollbar-none -mx-1 min-h-0 overflow-y-auto overscroll-contain px-1">
            {results ? (
              <>
                <p className="px-3 pb-1 pt-1 text-label text-subtle">
                  {results.length === 0
                    ? "No towers match"
                    : `${results.length}${results.length === MAX_RESULTS ? "+" : ""} ${results.length === 1 ? "tower" : "towers"}`}
                </p>
                <ul>
                  {results.map((a) => (
                    <AirportRow key={a.icao} airport={a} current={a.icao === selected} live={live} onPick={pick} />
                  ))}
                </ul>
              </>
            ) : country ? (
              <>
                <div className="flex items-center gap-2 pb-2">
                  <button
                    type="button"
                    onClick={() => setCountry(null)}
                    aria-label="All countries"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <Flag code={country} size={16} />
                  <h2 className="min-w-0 flex-1 truncate text-body font-medium">{countryName}</h2>
                  <span className="shrink-0 pr-3 text-label text-subtle">
                    {inCountry.length} {inCountry.length === 1 ? "tower" : "towers"}
                  </span>
                </div>
                <ul>
                  {inCountry.map((a) => (
                    <AirportRow key={a.icao} airport={a} current={a.icao === selected} live={live} onPick={pick} />
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2 className="px-3 pb-1 pt-1 text-label text-subtle">Popular</h2>
                <ul>
                  {featured.map((a) => (
                    <AirportRow key={a.icao} airport={a} current={a.icao === selected} live={live} onPick={pick} />
                  ))}
                </ul>
                <h2 className="px-3 pb-1 pt-4 text-label text-subtle">Countries</h2>
                <ul>
                  {countries.map((c) => (
                    <li key={c.code}>
                      <button
                        type="button"
                        onClick={() => pickCountry(c.code)}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-card"
                      >
                        <Flag code={c.code} size={16} />
                        <span className="min-w-0 flex-1 truncate text-body">{c.name}</span>
                        <span className="shrink-0 text-label text-subtle">{c.count}</span>
                        <ChevronRight className="size-4 shrink-0 text-subtle" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </motion.section>
    </>
  );
}

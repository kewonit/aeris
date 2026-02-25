"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, MapPin, ChevronRight } from "lucide-react";
import { REGIONS as CITIES, type City } from "@/lib/regions";
import { searchAirports, type Airport } from "@/lib/airports";
import { ScrollArea } from "@/components/ui/scroll-area";

type AirportSearchInputProps = {
  placeholder?: string;
  selected: Airport | null;
  onSelect: (airport: Airport) => void;
  onClear?: () => void;
  autoFocus?: boolean;
  label?: string;
};

export function AirportSearchInput({
  placeholder = "Search airports...",
  selected,
  onSelect,
  onClear,
  autoFocus = false,
  label = "Search airports",
}: AirportSearchInputProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { featured, airports } = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      return {
        featured: CITIES.slice(0, 10),
        airports: [] as ReturnType<typeof searchAirports>,
      };
    }

    const featured = CITIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iata.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q),
    );

    const featuredIatas = new Set(CITIES.map((c) => c.iata));
    const airports = searchAirports(q, 15).filter(
      (a) => !featuredIatas.has(a.iata),
    );

    return { featured, airports };
  }, [query]);

  const hasResults = featured.length > 0 || airports.length > 0;

  function handleSelect(airport: Airport) {
    onSelect(airport);
    setQuery("");
    setIsOpen(false);
  }

  function handleSelectCity(city: City) {
    const real = searchAirports(city.iata, 1).find((a) => a.iata === city.iata);
    const airport: Airport = real ?? {
      iata: city.iata,
      name: city.name,
      city: city.name,
      country: city.country,
      lat: city.coordinates[1],
      lng: city.coordinates[0],
    };
    handleSelect(airport);
  }

  function handleClear() {
    setQuery("");
    onClear?.();
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      {selected && !isOpen ? (
        <button
          onClick={() => {
            setIsOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition-colors hover:bg-white/6"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/8">
            <MapPin className="h-3 w-3 text-white/50" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-semibold text-white/80">
              {selected.iata}
            </span>
            <span className="ml-1.5 text-[11px] text-white/30">
              {selected.city}
            </span>
          </div>
          {onClear && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="shrink-0 text-white/20 hover:text-white/40 transition-colors"
              aria-label="Clear selection"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-white/25" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            aria-label={label}
            className="flex-1 bg-transparent text-[13px] font-medium text-white/90 placeholder:text-white/20 outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="shrink-0 text-white/20 hover:text-white/40 transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-white/8 bg-[#0c0c0e]/95 shadow-[0_20px_60px_rgba(0,0,0,.7)] backdrop-blur-2xl"
          >
            <ScrollArea className="max-h-56">
              <div className="p-1.5">
                {!hasResults && (
                  <p className="py-6 text-center text-[11px] text-white/25">
                    No airports found
                  </p>
                )}

                {featured.length > 0 && (
                  <>
                    {query && (
                      <p className="px-2.5 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-widest text-white/15">
                        Featured
                      </p>
                    )}
                    {featured.map((city) => (
                      <DropdownRow
                        key={city.id}
                        name={city.name}
                        detail={`${city.iata} · ${city.country}`}
                        isActive={selected?.iata === city.iata}
                        onClick={() => handleSelectCity(city)}
                      />
                    ))}
                  </>
                )}

                {airports.length > 0 && (
                  <>
                    <p
                      className={`px-2.5 pb-1 text-[9px] font-semibold uppercase tracking-widest text-white/15 ${featured.length > 0 ? "pt-2" : "pt-1.5"
                        }`}
                    >
                      Airports
                    </p>
                    {airports.map((airport) => (
                      <DropdownRow
                        key={airport.iata}
                        name={airport.name}
                        detail={`${airport.iata} · ${airport.city}, ${airport.country}`}
                        isActive={selected?.iata === airport.iata}
                        onClick={() => handleSelect(airport)}
                      />
                    ))}
                  </>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DropdownRow({
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
      className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5 ${isActive ? "bg-white/6" : ""
        }`}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/4">
        <MapPin className="h-3 w-3 text-white/35" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-[12px] font-medium text-white/75">{name}</p>
        <p className="text-[10px] text-white/25">{detail}</p>
      </div>
      <ChevronRight className="h-3 w-3 shrink-0 text-white/10 group-hover:text-white/20" />
    </button>
  );
}

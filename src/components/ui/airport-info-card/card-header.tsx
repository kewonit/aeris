"use client";

import { ChevronDown, X } from "lucide-react";
import type { Airport } from "@/lib/airports";
import { decodeFltCat } from "./formatters";
import type { MetarData } from "./types";

type Props = {
  airport: Airport;
  icao: string | null;
  metar: MetarData | null;
  /** The mobile sheet can fold its body away and close itself. */
  sheet?: {
    collapsed: boolean;
    onToggleCollapse: () => void;
    onClose: () => void;
  };
};

export function CardHeader({ airport, icao, metar, sheet }: Props) {
  const fltCat = decodeFltCat(metar?.fltcat);
  const place = [airport.city, airport.country].filter(Boolean).join(", ");

  return (
    <header className="flex items-start gap-3 px-6 py-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-title text-foreground">{airport.iata}</h2>
        <p className="truncate text-small text-muted-foreground">
          {airport.name}
        </p>
        <p className="mt-0.5 truncate font-mono text-micro text-subtle">
          {[icao, place].filter(Boolean).join(" · ")}
          {fltCat.label !== "-" && (
            <span className={fltCat.color}> · {fltCat.label}</span>
          )}
        </p>
      </div>

      {sheet && (
        <div className="-mt-2 -mr-3 flex shrink-0">
          <button
            type="button"
            onClick={sheet.onToggleCollapse}
            aria-expanded={!sheet.collapsed}
            aria-label={sheet.collapsed ? "Show airport details" : "Hide airport details"}
            className="grid size-11 place-items-center rounded-full text-subtle transition-colors hover:bg-card hover:text-foreground"
          >
            <ChevronDown
              className={`size-4 transition-transform ${sheet.collapsed ? "" : "rotate-180"}`}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            onClick={sheet.onClose}
            aria-label="Close airport details"
            className="grid size-11 place-items-center rounded-full text-subtle transition-colors hover:bg-card hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </header>
  );
}

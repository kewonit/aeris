"use client";

import { X } from "lucide-react";
import type { Airport } from "@/lib/airports";
import { decodeFltCat } from "./formatters";
import type { MetarData } from "./types";

type Props = {
  airport: Airport;
  icao: string | null;
  metar: MetarData | null;
  onClose?: () => void;
};

export function CardHeader({ airport, icao, metar, onClose }: Props) {
  const fltCat = decodeFltCat(metar?.fltCat ?? metar?.fltcat);
  const place = [airport.city, airport.country].filter(Boolean).join(", ");

  return (
    <header className="flex items-start gap-3 px-5 pt-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-title text-foreground">{airport.iata}</h2>
        <p className="truncate text-small text-muted-foreground">
          {airport.name}
        </p>
        <p className="mt-0.5 truncate text-label text-subtle">
          {[icao, place].filter(Boolean).join(" · ")}
          {fltCat.label !== "-" && (
            <span className={fltCat.color}> · {fltCat.label}</span>
          )}
        </p>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${airport.iata}`}
          className="-mt-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:text-foreground"
        >
          <span className="grid size-8 place-items-center rounded-full bg-card">
            <X className="size-4" aria-hidden="true" />
          </span>
        </button>
      )}
    </header>
  );
}

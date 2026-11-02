"use client";

import { CloseButton } from "@/components/ui/close-button";
import type { Airport } from "@/lib/airports";
import { decodeFltCat } from "./formatters";
import type { MetarData } from "./types";

type Props = {
  airport: Airport;
  icao: string | null;
  metar: MetarData | null;
  onClose?: () => void;
};

const COUNTRIES = new Intl.DisplayNames(["en"], { type: "region" });

/** "GB" as "United Kingdom"; anything that is not a region code as given. */
function countryName(code: string): string {
  try {
    return COUNTRIES.of(code) ?? code;
  } catch {
    return code;
  }
}

export function CardHeader({ airport, icao, metar, onClose }: Props) {
  const fltCat = decodeFltCat(metar?.fltCat ?? metar?.fltcat);
  const place = [airport.city, airport.country && countryName(airport.country)]
    .filter(Boolean)
    .join(", ");

  return (
    <header className="flex items-start gap-3 px-5 pt-4">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-baseline gap-2 text-title text-foreground">
          {airport.iata}
          {icao && (
            <span className="font-mono text-small text-subtle">{icao}</span>
          )}
        </h2>
        <p className="truncate text-small text-muted-foreground">
          {airport.name}
        </p>
        <p className="mt-0.5 flex min-w-0 gap-2 text-label text-subtle">
          {place && <span className="truncate">{place}</span>}
          {fltCat.label !== "-" && (
            <span className={`shrink-0 ${fltCat.color}`}>{fltCat.label}</span>
          )}
        </p>
      </div>

      {onClose && (
        <CloseButton
          label={`Close ${airport.iata}`}
          onClick={onClose}
          className="-mt-1 -mr-2"
        />
      )}
    </header>
  );
}

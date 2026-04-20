"use client";

import { ChevronDown, MapPin, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Airport } from "@/lib/airports";
import { decodeFltCat } from "./formatters";
import type { MetarData } from "./types";

type Props = {
  airport: Airport;
  icao: string | null;
  metar: MetarData | null;
  totalFlights?: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** When `showCloseButton` is true, a close (X) button is rendered inline.
   *  Hide this when the photo banner already provides a floating close. */
  showCloseButton: boolean;
  onClose: () => void;
};

/**
 * Sticky header row below the photo banner.
 *
 * Layout:
 *   [flt-cat dot / pin]  IATA · ICAO · FLT-CAT-BADGE · count-badge
 *   airport name
 *   city, country                                    [collapse ⌄]  [×]?
 *
 * The whole row is a button that toggles the collapsed body.
 * The inline close button is suppressed when the photo banner renders its
 * own floating close — avoids two close targets stacked vertically.
 */
export function CardHeader({
  airport,
  icao,
  metar,
  totalFlights,
  collapsed,
  onToggleCollapse,
  showCloseButton,
  onClose,
}: Props) {
  const fltCat = decodeFltCat(metar?.fltcat);
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-label={`${airport.name}, tap to ${collapsed ? "expand" : "collapse"} details`}
        className="group flex min-w-0 flex-1 items-start gap-2 p-4 pr-2 text-left transition-colors hover:bg-foreground/2 active:bg-foreground/4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {metar ? (
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${fltCat.dotColor}`}
                style={{ boxShadow: `0 0 6px 1px currentColor` }}
                aria-hidden
              />
            ) : (
              <MapPin
                className="h-4 w-4 shrink-0 text-foreground/30"
                aria-hidden
              />
            )}
            <p className="text-base font-semibold tracking-tight text-foreground">
              {airport.iata}
            </p>
            {icao && (
              <span className="font-mono text-[10px] font-medium tracking-widest text-foreground/35">
                {icao}
              </span>
            )}
            {metar && (
              <span
                className={`rounded-md bg-foreground/5 px-1.5 py-0.5 text-[9px] font-bold tracking-wider ring-1 ring-foreground/6 ${fltCat.color}`}
              >
                {fltCat.label}
              </span>
            )}
            {typeof totalFlights === "number" && totalFlights > 0 && (
              <span className="ml-auto shrink-0 rounded-full bg-foreground/6 px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-foreground/55">
                {totalFlights}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[11px] font-medium text-balance text-foreground/55">
            {airport.name}
          </p>
          <p className="truncate text-[10px] text-foreground/30">
            {airport.city}
            {airport.country ? `, ${airport.country}` : ""}
          </p>
        </div>

        {/* Collapse chevron — lives inside the header button, so clicks anywhere on header toggle */}
        <motion.span
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", duration: 0.3, bounce: 0 }
          }
          className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground/35 [transition-property:background-color,color] [transition-duration:180ms] group-hover:bg-foreground/5 group-hover:text-foreground/60"
          aria-hidden
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      {showCloseButton && (
        <button
          type="button"
          onClick={onClose}
          className="mr-2 mt-2 flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-[10px] bg-foreground/5 text-foreground/45 [transition-property:background-color,color,scale] [transition-duration:180ms] hover:bg-foreground/10 hover:text-foreground/80 active:scale-[0.96]"
          aria-label="Close airport info"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

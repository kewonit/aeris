"use client";

import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Airport } from "@/lib/airports";
import { decodeFltCat } from "./formatters";
import type { MetarData } from "./types";

type Props = {
  airport: Airport;
  icao: string | null;
  metar: MetarData | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

/**
 * Sticky header row below the photo banner.
 *
 * Layout:
 *   IATA · ICAO · FLT-CAT-BADGE
 *   airport name
 *   city, country                                    [collapse ⌄]
 *
 * The whole row is a button that toggles the collapsed body.
 */
export function CardHeader({
  airport,
  icao,
  metar,
  collapsed,
  onToggleCollapse,
}: Props) {
  const fltCat = decodeFltCat(metar?.fltcat);
  const hasFltCat = fltCat.label !== "—";
  const reduceMotion = useReducedMotion();

  return (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-expanded={!collapsed}
      aria-label={`${airport.name}, tap to ${collapsed ? "expand" : "collapse"} details`}
      className="group flex w-full items-start gap-2 p-4 text-left transition-colors hover:bg-foreground/2 active:bg-foreground/4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-base font-semibold tracking-tight text-foreground">
            {airport.iata}
          </p>
          {icao && (
            <span className="font-mono text-[10px] font-medium tracking-widest text-foreground/35">
              {icao}
            </span>
          )}
          {hasFltCat && (
            <span
              className={`rounded-md bg-foreground/5 px-1.5 py-0.5 text-[9px] font-bold tracking-wider ring-1 ring-foreground/6 ${fltCat.color}`}
            >
              {fltCat.label}
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
  );
}

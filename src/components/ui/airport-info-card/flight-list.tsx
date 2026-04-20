"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { BoardFlight } from "@/hooks/use-airport-board";
import { useSettings } from "@/hooks/use-settings";
import { formatVerticalSpeedValue } from "@/lib/unit-formatters";

function statusStyle(status: string): {
  text: string;
  dot: string;
  glow: string;
} {
  switch (status) {
    case "Final":
      return {
        text: "text-emerald-400",
        dot: "bg-emerald-400",
        glow: "shadow-emerald-400/20",
      };
    case "Approach":
      return {
        text: "text-emerald-400/80",
        dot: "bg-emerald-400/80",
        glow: "",
      };
    case "Inbound":
      return { text: "text-teal-400/70", dot: "bg-teal-400/70", glow: "" };
    case "Descending":
      return {
        text: "text-emerald-400/60",
        dot: "bg-emerald-400/60",
        glow: "",
      };
    case "Departure":
      return {
        text: "text-amber-400",
        dot: "bg-amber-400",
        glow: "shadow-amber-400/20",
      };
    case "Climbing":
      return { text: "text-amber-400/80", dot: "bg-amber-400/80", glow: "" };
    case "Outbound":
      return { text: "text-orange-400/70", dot: "bg-orange-400/70", glow: "" };
    default:
      return { text: "text-foreground/30", dot: "bg-foreground/20", glow: "" };
  }
}

function VRate({ rate }: { rate: number | null }) {
  const { settings } = useSettings();
  if (rate === null || !Number.isFinite(rate)) {
    return <span className="text-[11px] text-foreground/15">—</span>;
  }
  const vSpeed = formatVerticalSpeedValue(rate, settings.unitSystem);
  if (vSpeed.value === null) {
    return <span className="text-[11px] text-foreground/15">—</span>;
  }
  const isMetric = settings.unitSystem === "metric";
  const levelThreshold = isMetric ? 0.5 : 100;
  if (Math.abs(vSpeed.value) < levelThreshold) {
    return <span className="inline-block h-px w-3 bg-foreground/15" />;
  }
  const isDown = vSpeed.value < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums ${
        isDown ? "text-emerald-400/60" : "text-amber-400/60"
      }`}
    >
      {isDown ? (
        <ArrowDown className="h-2.5 w-2.5" />
      ) : (
        <ArrowUp className="h-2.5 w-2.5" />
      )}
      <span>{Math.abs(vSpeed.value).toLocaleString()}</span>
    </span>
  );
}

function FlightRow({
  flight,
  isSelected,
  onSelect,
  index,
}: {
  flight: BoardFlight;
  isSelected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const style = statusStyle(flight.status);
  const isUrgent = flight.status === "Final" || flight.status === "Departure";
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={{
        duration: reduceMotion ? 0 : 0.2,
        ease: [0.25, 0.1, 0.25, 1],
        delay: reduceMotion ? 0 : Math.min(index * 0.02, 0.15),
      }}
      onClick={onSelect}
      type="button"
      className={`group flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left [transition-property:background-color,scale] [transition-duration:180ms] active:scale-[0.96] ${
        isSelected ? "bg-foreground/8" : "hover:bg-foreground/4"
      }`}
      aria-label={`${flight.callsign} — ${flight.status}, ${flight.altitude}, ${flight.distanceFormatted}`}
      aria-pressed={isSelected}
    >
      <span
        className={`block h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${
          isUrgent ? "animate-pulse" : ""
        } ${style.glow ? `shadow-md ${style.glow}` : ""}`}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-foreground/80">
        {flight.callsign}
      </span>
      <span className={`shrink-0 text-[10px] font-medium ${style.text}`}>
        {flight.status}
      </span>
      <span className="hidden w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground/40 sm:inline">
        {flight.altitude}
      </span>
      <span className="hidden w-12 shrink-0 justify-end sm:inline-flex">
        <VRate rate={flight.verticalRate} />
      </span>
      <span className="ml-auto w-11 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground/30">
        {flight.distanceFormatted}
      </span>
    </motion.button>
  );
}

type Props = {
  flights: BoardFlight[];
  selectedIcao24: string | null;
  onSelectFlight: (icao24: string) => void;
  emptyMessage?: string;
};

export function FlightList({
  flights,
  selectedIcao24,
  onSelectFlight,
  emptyMessage,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(flights.length);

  useEffect(() => {
    if (flights.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    prevCountRef.current = flights.length;
  }, [flights.length]);

  if (flights.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center">
        <span className="text-[12px] font-medium text-foreground/20">
          {emptyMessage ?? "No flights"}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="scrollbar-none max-h-60 overflow-y-auto overscroll-contain pr-0.5"
    >
      <div className="space-y-0.5">
        <AnimatePresence initial={false}>
          {flights.map((f, i) => (
            <FlightRow
              key={f.icao24}
              flight={f}
              isSelected={f.icao24 === selectedIcao24}
              onSelect={() => onSelectFlight(f.icao24)}
              index={i}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

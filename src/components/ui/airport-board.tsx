"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  PlaneLanding,
  PlaneTakeoff,
  X,
  ChevronDown,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import type { BoardFlight, AirportBoardData } from "@/hooks/use-airport-board";
import { formatVerticalSpeedValue } from "@/lib/unit-formatters";

// ── Types ──────────────────────────────────────────────────────────────

type AirportBoardProps = {
  data: AirportBoardData;
  onSelectFlight: (icao24: string) => void;
  selectedIcao24: string | null;
  onClose: () => void;
};

type Tab = "arrivals" | "departures";

// ── Shared spring config ───────────────────────────────────────────────

const SPRING = {
  type: "spring" as const,
  stiffness: 500,
  damping: 35,
  mass: 0.7,
};
const SPRING_GENTLE = {
  type: "spring" as const,
  stiffness: 300,
  damping: 28,
  mass: 0.8,
};

// ── Status styling ─────────────────────────────────────────────────────

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
      return {
        text: "text-amber-400/80",
        dot: "bg-amber-400/80",
        glow: "",
      };
    case "Outbound":
      return {
        text: "text-orange-400/70",
        dot: "bg-orange-400/70",
        glow: "",
      };
    default:
      return { text: "text-foreground/30", dot: "bg-foreground/20", glow: "" };
  }
}

// ── Vertical rate ──────────────────────────────────────────────────────

function VRate({ rate }: { rate: number | null }) {
  const { settings } = useSettings();
  if (rate === null || !Number.isFinite(rate)) {
    return <span className="text-xs text-foreground/15">—</span>;
  }

  const vSpeed = formatVerticalSpeedValue(rate, settings.unitSystem);
  if (vSpeed.value === null) {
    return <span className="text-xs text-foreground/15">—</span>;
  }

  const isMetric = settings.unitSystem === "metric";
  const levelThreshold = isMetric ? 0.5 : 100;
  if (Math.abs(vSpeed.value) < levelThreshold) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-foreground/20">
        <span className="inline-block h-px w-3 bg-foreground/15" />
      </span>
    );
  }

  const isDown = vSpeed.value < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-xs tabular-nums ${
        isDown ? "text-emerald-400/60" : "text-amber-400/60"
      }`}
    >
      {isDown ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUp className="h-3 w-3" />
      )}
      <span>{Math.abs(vSpeed.value).toLocaleString()}</span>
    </span>
  );
}

// ── Flight row ─────────────────────────────────────────────────────────

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

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{
        duration: 0.2,
        ease: [0.25, 0.1, 0.25, 1],
        delay: Math.min(index * 0.02, 0.15),
      }}
      onClick={onSelect}
      className={`group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
        isSelected
          ? "bg-foreground/8"
          : "hover:bg-foreground/4 active:bg-foreground/6"
      }`}
      aria-label={`${flight.callsign} — ${flight.status}, ${flight.altitude}, ${flight.distanceFormatted}`}
    >
      {/* Status dot */}
      <span
        className={`block h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${
          isUrgent ? "animate-pulse" : ""
        } ${style.glow ? `shadow-md ${style.glow}` : ""}`}
      />

      {/* Callsign */}
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-foreground/80">
        {flight.callsign}
      </span>

      {/* Status */}
      <span className={`shrink-0 text-[11px] font-medium ${style.text}`}>
        {flight.status}
      </span>

      {/* Distance */}
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/30">
        {flight.distanceFormatted}
      </span>
    </motion.button>
  );
}

// ── Table header ───────────────────────────────────────────────────────

function TableHead() {
  return (
    <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-1">
      {/* dot spacer */}
      <span className="w-3 shrink-0" />
      <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-widest text-foreground/20">
        Flight
      </span>
      <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-widest text-foreground/20">
        Status
      </span>
      <span className="hidden w-14 shrink-0 text-right text-[10px] font-medium uppercase tracking-widest text-foreground/20 sm:block">
        Alt
      </span>
      <span className="hidden w-12 shrink-0 text-right text-[10px] font-medium uppercase tracking-widest text-foreground/20 sm:block">
        V/S
      </span>
      <span className="ml-auto w-12 shrink-0 text-right text-[10px] font-medium uppercase tracking-widest text-foreground/20">
        Dist
      </span>
    </div>
  );
}

// ── Flight list ────────────────────────────────────────────────────────

function FlightList({
  flights,
  selectedIcao24,
  onSelectFlight,
  emptyMessage,
}: {
  flights: BoardFlight[];
  selectedIcao24: string | null;
  onSelectFlight: (icao24: string) => void;
  emptyMessage?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(flights.length);

  // Auto-scroll to top when new flights appear at the top (closer distance)
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
    <>
      <div
        ref={scrollRef}
        className="scrollbar-none max-h-[60vh] overflow-y-auto overscroll-contain px-1 pb-2"
      >
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
    </>
  );
}

// ── Empty state ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={SPRING_GENTLE}
      className="flex h-32 flex-col items-center justify-center gap-3"
    >
      <div className="flex items-center gap-4 text-foreground/8">
        <PlaneLanding className="h-5 w-5" />
        <div className="h-4 w-px bg-foreground/6" />
        <PlaneTakeoff className="h-5 w-5" />
      </div>
      <span className="text-[11px] font-medium tracking-wide text-foreground/18">
        No air traffic nearby
      </span>
    </motion.div>
  );
}

// ── Segmented Control ──────────────────────────────────────────────────

function SegmentedControl({
  activeTab,
  onTabChange,
  arrivalsCount,
  departuresCount,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  arrivalsCount: number;
  departuresCount: number;
}) {
  return (
    <div className="mx-3.5 mt-3 mb-1.5">
      <div className="relative flex h-9 rounded-xl bg-foreground/4 p-0.5">
        {/* Animated pill background */}
        <motion.div
          className="absolute top-0.5 bottom-0.5 rounded-[10px]"
          animate={{
            left: activeTab === "arrivals" ? "2px" : "50%",
            right: activeTab === "arrivals" ? "50%" : "2px",
          }}
          transition={SPRING}
          style={{
            background:
              activeTab === "arrivals"
                ? "rgba(52, 211, 153, 0.10)"
                : "rgba(251, 191, 36, 0.10)",
            border:
              activeTab === "arrivals"
                ? "1px solid rgba(52, 211, 153, 0.12)"
                : "1px solid rgba(251, 191, 36, 0.12)",
          }}
        />

        <button
          onClick={() => onTabChange("arrivals")}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-semibold tracking-wide transition-colors duration-200 ${
            activeTab === "arrivals"
              ? "text-emerald-400/90"
              : "text-foreground/30 hover:text-foreground/45"
          }`}
        >
          <PlaneLanding className="h-3.5 w-3.5" />
          <span>Arrivals</span>
          <span
            className={`ml-0.5 rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums ${
              activeTab === "arrivals"
                ? "bg-emerald-400/10 text-emerald-400/70"
                : "bg-foreground/4 text-foreground/20"
            }`}
          >
            {arrivalsCount}
          </span>
        </button>

        <button
          onClick={() => onTabChange("departures")}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-semibold tracking-wide transition-colors duration-200 ${
            activeTab === "departures"
              ? "text-amber-400/90"
              : "text-foreground/30 hover:text-foreground/45"
          }`}
        >
          <PlaneTakeoff className="h-3.5 w-3.5" />
          <span>Departures</span>
          <span
            className={`ml-0.5 rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums ${
              activeTab === "departures"
                ? "bg-amber-400/10 text-amber-400/70"
                : "bg-foreground/4 text-foreground/20"
            }`}
          >
            {departuresCount}
          </span>
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function AirportBoard({
  data,
  onSelectFlight,
  selectedIcao24,
  onClose,
}: AirportBoardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("arrivals");

  const { arrivals, departures, airport, totalFlights } = data;

  const effectiveTab: Tab =
    activeTab === "arrivals" && arrivals.length === 0 && departures.length > 0
      ? "departures"
      : activeTab === "departures" &&
          departures.length === 0 &&
          arrivals.length > 0
        ? "arrivals"
        : activeTab;

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const handleHeaderKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleToggleCollapse();
      }
    },
    [handleToggleCollapse],
  );

  if (!airport) return null;

  const currentFlights = effectiveTab === "arrivals" ? arrivals : departures;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={SPRING_GENTLE}
      className="w-80 sm:w-96"
    >
      <div className="overflow-hidden rounded-2xl border border-foreground/8 bg-background/60 shadow-2xl shadow-background/40 backdrop-blur-2xl">
        {/* ── Header ── */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleToggleCollapse}
          onKeyDown={handleHeaderKeyDown}
          className="flex w-full cursor-pointer select-none items-center justify-between px-4 py-3 transition-colors duration-150 hover:bg-foreground/2 active:bg-foreground/4"
        >
          <div className="flex items-center gap-3 overflow-hidden">
            {/* Live pulse */}
            <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400/20 duration-[3s]" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400/80 shadow-sm shadow-emerald-400/25" />
            </div>

            {/* Airport IATA + name */}
            <div className="flex min-w-0 items-baseline gap-2.5">
              <span className="shrink-0 font-mono text-[15px] font-bold tracking-wide text-foreground/90">
                {airport.iata}
              </span>
              <span className="hidden min-w-0 max-w-44 truncate text-[12px] font-medium text-foreground/30 sm:inline">
                {airport.name}
              </span>
            </div>

            {/* Flight count badge */}
            <span className="shrink-0 rounded-full bg-foreground/4 px-2.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground/30">
              {totalFlights} {totalFlights === 1 ? "flight" : "flights"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Collapse indicator */}
            <motion.div
              animate={{ rotate: collapsed ? 0 : 180 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex h-5 w-5 items-center justify-center"
            >
              <ChevronDown className="h-3.5 w-3.5 text-foreground/20" />
            </motion.div>

            {/* Close button — outside of the role="button" div via stopPropagation */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-foreground/20 transition-all duration-150 hover:bg-foreground/6 hover:text-foreground/45 active:scale-95"
              aria-label="Close airport board"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              {/* Gradient divider */}
              <div className="h-px bg-linear-to-r from-transparent via-foreground/6 to-transparent" />

              {totalFlights === 0 ? (
                <EmptyState />
              ) : (
                <>
                  {/* ── Desktop: side-by-side columns ── */}
                  <div className="hidden sm:block">
                    <SegmentedControl
                      activeTab={effectiveTab}
                      onTabChange={setActiveTab}
                      arrivalsCount={arrivals.length}
                      departuresCount={departures.length}
                    />
                    <div className="px-1 pb-1 pt-0.5">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={effectiveTab}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{
                            duration: 0.15,
                            ease: [0.25, 0.1, 0.25, 1],
                          }}
                        >
                          <FlightList
                            flights={currentFlights}
                            selectedIcao24={selectedIcao24}
                            onSelectFlight={onSelectFlight}
                            emptyMessage={
                              effectiveTab === "arrivals"
                                ? "No arriving flights"
                                : "No departing flights"
                            }
                          />
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* ── Mobile: segmented control + single list ── */}
                  <div className="sm:hidden">
                    <SegmentedControl
                      activeTab={effectiveTab}
                      onTabChange={setActiveTab}
                      arrivalsCount={arrivals.length}
                      departuresCount={departures.length}
                    />

                    <div className="px-1 pb-1 pt-0.5">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={effectiveTab}
                          initial={{
                            opacity: 0,
                            x: effectiveTab === "arrivals" ? -8 : 8,
                          }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{
                            opacity: 0,
                            x: effectiveTab === "arrivals" ? 8 : -8,
                          }}
                          transition={{
                            duration: 0.18,
                            ease: [0.25, 0.1, 0.25, 1],
                          }}
                        >
                          <FlightList
                            flights={currentFlights}
                            selectedIcao24={selectedIcao24}
                            onSelectFlight={onSelectFlight}
                            emptyMessage={
                              effectiveTab === "arrivals"
                                ? "No arriving flights"
                                : "No departing flights"
                            }
                          />
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

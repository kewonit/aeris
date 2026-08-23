"use client";

import { useEffect, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { FlightState, FlightTrack } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import type { AirportBoardData } from "@/hooks/use-airport-board";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarProvider,
} from "@/components/ui/sidebar";

const FlightCard = dynamic(() =>
  import("@/components/ui/flight-card").then((mod) => mod.FlightCard),
);

const AirportInfoCard = dynamic(() =>
  import("@/components/ui/airport-info-card").then(
    (mod) => mod.AirportInfoCard,
  ),
);

export type AerisLeftPanel =
  | { kind: "flight" }
  | { kind: "airport" };

export const AERIS_LEFT_SIDEBAR_WIDTH = "clamp(22rem, 30vw, 28rem)";

type AerisLeftSidebarProps = {
  leftPanel: AerisLeftPanel | null;
  onClose: () => void;
  displayFlight: FlightState | null;
  selectedTrail: TrailEntry | null;
  selectedTrack: FlightTrack | null;
  onCloseFlight: () => void;
  onToggleFpv: (icao24: string) => void;
  isFpvActive: boolean;
  airportBoard: AirportBoardData;
  onSelectAirportFlight: (icao24: string) => void;
  selectedIcao24: string | null;
  onCloseAirport: () => void;
  atc: UseAtcStreamReturn;
};

export function AerisLeftSidebar({
  leftPanel,
  onClose,
  displayFlight,
  selectedTrail,
  selectedTrack,
  onCloseFlight,
  onToggleFpv,
  isFpvActive,
  airportBoard,
  onSelectAirportFlight,
  selectedIcao24,
  onCloseAirport,
  atc,
}: AerisLeftSidebarProps) {
  const isOpen = leftPanel !== null;
  const [renderedPanel, setRenderedPanel] = useState<AerisLeftPanel | null>(
    leftPanel,
  );
  const panel = leftPanel ?? renderedPanel;

  useEffect(() => {
    if (leftPanel) {
      const timeout = window.setTimeout(() => setRenderedPanel(leftPanel), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => setRenderedPanel(null), 420);
    return () => window.clearTimeout(timeout);
  }, [leftPanel]);

  const title =
    panel?.kind === "flight"
      ? "Aircraft details"
      : panel?.kind === "airport"
        ? "Airport Board"
        : "Aeris";

  const contentKey =
    panel?.kind === "flight"
      ? `flight-${displayFlight?.icao24 ?? "none"}`
      : panel?.kind === "airport"
        ? `airport-${airportBoard.airport?.iata ?? "none"}`
        : "closed";

  const handleCloseButton = () => {
    if (leftPanel?.kind === "flight") {
      onCloseFlight();
      return;
    }
    if (leftPanel?.kind === "airport") {
      onCloseAirport();
      return;
    }
    onClose();
  };

  return (
    <SidebarProvider
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      persistState={false}
      data-sidebar-open={isOpen}
      className="pointer-events-none fixed inset-0 z-40 min-h-0 w-auto overflow-visible bg-transparent"
      style={
        {
          "--sidebar-width": AERIS_LEFT_SIDEBAR_WIDTH,
        } as CSSProperties
      }
    >
      <Sidebar
        side="left"
        variant="sidebar"
        collapsible="offcanvas"
        reserveSpace={false}
        aria-hidden={!isOpen}
        inert={isOpen ? undefined : true}
        className="pointer-events-auto border-0 border-transparent p-0 shadow-none"
      >
        <SidebarHeader className="border-0 px-5 py-4 shadow-none">
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate text-[14px] font-semibold leading-5 tracking-tight text-sidebar-foreground/90">
              {title}
            </h2>
            <button
              type="button"
              onClick={handleCloseButton}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent/80 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/75"
              aria-label="Close left panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </SidebarHeader>

        <SidebarContent className="gap-0 overflow-hidden border-0 p-0 shadow-none">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={contentKey}
              className="min-h-0 flex-1"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            >
              {panel?.kind === "flight" && displayFlight ? (
                <FlightCard
                  flight={displayFlight}
                  trail={selectedTrail}
                  track={selectedTrack}
                  onClose={onCloseFlight}
                  onToggleFpv={onToggleFpv}
                  isFpvActive={isFpvActive}
                  variant="sidebar"
                />
              ) : panel?.kind === "airport" ? (
                <AirportInfoCard
                  board={airportBoard}
                  onSelectFlight={onSelectAirportFlight}
                  selectedIcao24={selectedIcao24}
                  onClose={onCloseAirport}
                  atc={atc}
                  variant="sidebar"
                />
              ) : (
                <EmptySidebarState />
              )}
            </motion.div>
          </AnimatePresence>
        </SidebarContent>

      </Sidebar>
    </SidebarProvider>
  );
}

function EmptySidebarState() {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-[12px] font-medium text-sidebar-foreground/35">
      Nothing selected
    </div>
  );
}

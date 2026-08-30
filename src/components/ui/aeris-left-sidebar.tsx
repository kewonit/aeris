"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import dynamic from "next/dynamic";
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
const AERIS_LEFT_SIDEBAR_OVERLAP_PX = 4;

type AerisLeftPanelSnapshot =
  | {
      kind: "flight";
      flight: FlightState;
      trail: TrailEntry | null;
      track: FlightTrack | null;
    }
  | {
      kind: "airport";
      board: AirportBoardData;
      selectedIcao24: string | null;
    };

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
  onInsetChange: (leftInsetPx: number) => void;
  onRestoreFocus: () => void;
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
  onInsetChange,
  onRestoreFocus,
}: AerisLeftSidebarProps) {
  const isOpen = leftPanel !== null;
  const sidebarRootRef = useRef<HTMLDivElement>(null);
  const currentSnapshot = useMemo<AerisLeftPanelSnapshot | null>(
    () =>
      leftPanel?.kind === "flight" && displayFlight
        ? {
            kind: "flight",
            flight: displayFlight,
            trail: selectedTrail,
            track: selectedTrack,
          }
        : leftPanel?.kind === "airport" &&
            airportBoard.isActive &&
            airportBoard.airport
          ? {
              kind: "airport",
              board: airportBoard,
              selectedIcao24,
            }
          : null,
    [
      airportBoard,
      displayFlight,
      leftPanel,
      selectedIcao24,
      selectedTrack,
      selectedTrail,
    ],
  );
  const [snapshotMemory, setSnapshotMemory] = useState<{
    observed: AerisLeftPanelSnapshot | null;
    retained: AerisLeftPanelSnapshot | null;
  }>({ observed: currentSnapshot, retained: currentSnapshot });
  if (currentSnapshot !== snapshotMemory.observed) {
    setSnapshotMemory({
      observed: currentSnapshot,
      retained: currentSnapshot ?? snapshotMemory.retained,
    });
  }

  useEffect(() => {
    const sidebarContainer = sidebarRootRef.current?.querySelector<HTMLElement>(
      '[data-slot="sidebar-container"]',
    );
    if (!sidebarContainer) return;

    const reportInset = () => {
      onInsetChange(
        Math.max(
          0,
          sidebarContainer.offsetWidth - AERIS_LEFT_SIDEBAR_OVERLAP_PX,
        ),
      );
    };

    reportInset();
    const observer = new ResizeObserver(reportInset);
    observer.observe(sidebarContainer);

    return () => observer.disconnect();
  }, [onInsetChange]);

  const snapshot =
    currentSnapshot ??
    (!leftPanel || snapshotMemory.retained?.kind === leftPanel.kind
      ? snapshotMemory.retained
      : null);

  const title =
    snapshot?.kind === "flight"
      ? "Aircraft details"
      : snapshot?.kind === "airport"
        ? "Airport Board"
        : "Aeris";

  const handleCloseButton = () => {
    if (leftPanel?.kind === "flight") {
      onCloseFlight();
    } else if (leftPanel?.kind === "airport") {
      onCloseAirport();
    } else {
      onClose();
    }
    onRestoreFocus();
  };

  return (
    <SidebarProvider
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      persistState={false}
      keyboardShortcut={false}
      data-sidebar-open={isOpen}
      ref={sidebarRootRef}
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
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "translate" &&
            !isOpen
          ) {
            setSnapshotMemory({ observed: null, retained: null });
          }
        }}
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
          <div className="min-h-0 flex-1">
            {snapshot?.kind === "flight" ? (
              <FlightCard
                flight={snapshot.flight}
                trail={snapshot.trail}
                track={snapshot.track}
                onClose={onCloseFlight}
                onToggleFpv={onToggleFpv}
                isFpvActive={isFpvActive}
                variant="sidebar"
              />
            ) : snapshot?.kind === "airport" ? (
              <AirportInfoCard
                board={snapshot.board}
                onSelectFlight={onSelectAirportFlight}
                selectedIcao24={snapshot.selectedIcao24}
                onClose={onCloseAirport}
                atc={atc}
                variant="sidebar"
              />
            ) : null}
          </div>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

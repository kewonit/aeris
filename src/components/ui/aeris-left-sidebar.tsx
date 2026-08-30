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
  const contextLabel =
    snapshot?.kind === "flight"
      ? snapshot.flight.callsign?.trim() ||
        snapshot.flight.registration?.trim() ||
        snapshot.flight.icao24.toUpperCase()
      : snapshot?.kind === "airport"
        ? [snapshot.board.airport?.iata, snapshot.board.airport?.city]
            .filter((value): value is string => Boolean(value))
            .join(" · ")
        : null;

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
        data-panel-kind={snapshot?.kind}
        className="aeris-sidebar-shell pointer-events-auto border-0 border-transparent p-0 shadow-none"
        innerClassName="bg-sidebar/90 backdrop-blur-3xl backdrop-saturate-[1.8]"
      >
        <SidebarHeader className="aeris-sidebar-toolbar relative z-10 border-0 px-4 py-2.5 shadow-none backdrop-blur-xl backdrop-saturate-[1.7]">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold leading-4 tracking-[-0.01em] text-sidebar-foreground/92">
                {title}
              </h2>
              {contextLabel && (
                <p className="mt-0.5 truncate text-[11px] font-medium leading-4 tracking-[0.01em] text-sidebar-foreground/45">
                  {contextLabel}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleCloseButton}
              className="aeris-sidebar-control flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-sidebar-foreground/55 backdrop-blur-xl backdrop-saturate-[1.6] [transition-duration:100ms] [transition-property:background-color,color,scale] hover:text-sidebar-foreground/90 active:scale-[0.92]"
              aria-label="Close left panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </SidebarHeader>

        <SidebarContent className="aeris-sidebar-content gap-0 overflow-hidden border-0 p-0 shadow-none">
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

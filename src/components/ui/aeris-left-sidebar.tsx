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
import type { FlightState } from "@/lib/opensky";
import type { AirportBoardData } from "@/hooks/use-airport-board";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";

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
/** How far the sidebar tucks under the rounded map edge. */
export const AERIS_LEFT_SIDEBAR_OVERLAP_PX = 4;

type AerisLeftPanelSnapshot =
  | { kind: "flight"; flight: FlightState }
  | {
      kind: "airport";
      board: AirportBoardData;
      selectedIcao24: string | null;
    };

type AerisLeftSidebarProps = {
  leftPanel: AerisLeftPanel | null;
  onClose: () => void;
  displayFlight: FlightState | null;
  onCloseFlight: () => void;
  onToggleFpv: (icao24: string) => void;
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
  onCloseFlight,
  onToggleFpv,
  airportBoard,
  onSelectAirportFlight,
  selectedIcao24,
  onCloseAirport,
  atc,
  onInsetChange,
  onRestoreFocus,
}: AerisLeftSidebarProps) {
  const isOpen = leftPanel !== null;
  const asideRef = useRef<HTMLElement>(null);
  const currentSnapshot = useMemo<AerisLeftPanelSnapshot | null>(
    () =>
      leftPanel?.kind === "flight" && displayFlight
        ? { kind: "flight", flight: displayFlight }
        : leftPanel?.kind === "airport" &&
            airportBoard.isActive &&
            airportBoard.airport
          ? {
              kind: "airport",
              board: airportBoard,
              selectedIcao24,
            }
          : null,
    [airportBoard, displayFlight, leftPanel, selectedIcao24],
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
    const aside = asideRef.current;
    if (!aside) return;

    const reportInset = () => {
      onInsetChange(
        Math.max(0, aside.offsetWidth - AERIS_LEFT_SIDEBAR_OVERLAP_PX),
      );
    };

    reportInset();
    const observer = new ResizeObserver(reportInset);
    observer.observe(aside);

    return () => observer.disconnect();
  }, [onInsetChange]);

  const snapshot =
    currentSnapshot ??
    (!leftPanel || snapshotMemory.retained?.kind === leftPanel.kind
      ? snapshotMemory.retained
      : null);

  const label =
    snapshot?.kind === "airport" ? "Airport details" : "Aircraft details";

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
    <aside
      ref={asideRef}
      aria-label={label}
      aria-hidden={!isOpen}
      inert={!isOpen}
      data-open={isOpen}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !isOpen) {
          setSnapshotMemory({ observed: null, retained: null });
        }
      }}
      className="pointer-events-auto fixed inset-y-0 left-0 z-40 hidden w-(--aeris-sidebar-width) flex-col border-r border-border bg-background text-foreground transition-transform duration-(--panel-duration) ease-(--panel-ease) data-[open=false]:-translate-x-full sm:flex"
      style={
        { "--aeris-sidebar-width": AERIS_LEFT_SIDEBAR_WIDTH } as CSSProperties
      }
    >
      <button
        type="button"
        onClick={handleCloseButton}
        className="absolute top-2 right-2 z-10 grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`Close ${label.toLowerCase()}`}
      >
        <span className="grid size-8 place-items-center rounded-full bg-background shadow-lift">
          <X className="size-4" aria-hidden="true" />
        </span>
      </button>

      <div className="min-h-0 flex-1">
        {snapshot?.kind === "flight" ? (
          <FlightCard flight={snapshot.flight} onToggleFpv={onToggleFpv} />
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
    </aside>
  );
}

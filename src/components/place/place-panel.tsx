"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import dynamic from "next/dynamic";
import type { FlightState } from "@/lib/opensky";
import type { AirportBoardData } from "@/hooks/use-airport-board";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import { ScrollArea } from "@/components/ui/scroll-area";

const AircraftCard = dynamic(() =>
  import("@/components/place/aircraft-card").then((mod) => mod.AircraftCard),
);

const AirportInfoCard = dynamic(() =>
  import("@/components/ui/airport-info-card").then(
    (mod) => mod.AirportInfoCard,
  ),
);

export type PlacePanelKind =
  | { kind: "flight" }
  | { kind: "airport" };

/** The desktop panel's width, beside the map rather than over its middle. */
export const PLACE_PANEL_WIDTH = "clamp(22rem, 28vw, 25rem)";
/** Clear space between the panel and what the camera centres beside it. */
const PANEL_GAP_PX = 12;

type PlacePanelSnapshot =
  | { kind: "flight"; flight: FlightState }
  | {
      kind: "airport";
      board: AirportBoardData;
      selectedIcao24: string | null;
    };

type PlacePanelProps = {
  leftPanel: PlacePanelKind | null;
  displayFlight: FlightState | null;
  onCloseFlight: () => void;
  onToggleFpv: (icao24: string) => void;
  followIcao24: string | null;
  onToggleFollow?: (icao24: string) => void;
  airportBoard: AirportBoardData;
  onSelectAirportFlight: (icao24: string) => void;
  selectedIcao24: string | null;
  onCloseAirport: () => void;
  atc: UseAtcStreamReturn;
  onInsetChange: (leftInsetPx: number) => void;
  onRestoreFocus: () => void;
};

/**
 * The desktop's place card: a panel that floats inset over the map, under
 * the search field, rather than pushing the map aside. The camera keeps
 * what is selected in the clear space beside it.
 */
export function PlacePanel({
  leftPanel,
  displayFlight,
  onCloseFlight,
  onToggleFpv,
  followIcao24,
  onToggleFollow,
  airportBoard,
  onSelectAirportFlight,
  selectedIcao24,
  onCloseAirport,
  atc,
  onInsetChange,
  onRestoreFocus,
}: PlacePanelProps) {
  const isOpen = leftPanel !== null;
  const asideRef = useRef<HTMLElement>(null);
  const currentSnapshot = useMemo<PlacePanelSnapshot | null>(
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
    observed: PlacePanelSnapshot | null;
    retained: PlacePanelSnapshot | null;
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
      onInsetChange(Math.max(0, aside.offsetLeft + aside.offsetWidth + PANEL_GAP_PX));
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
      className="aeris-float pointer-events-auto fixed top-17 bottom-4 left-4 z-30 hidden w-(--place-width) flex-col overflow-hidden rounded-xl text-foreground transition-[translate,opacity] duration-(--panel-duration) ease-(--panel-ease) data-[open=false]:-translate-x-4 data-[open=false]:opacity-0 sm:flex"
      style={{ "--place-width": PLACE_PANEL_WIDTH } as CSSProperties}
    >
      <div className="min-h-0 flex-1">
        {snapshot?.kind === "flight" ? (
          <ScrollArea className="h-full">
            <AircraftCard
              flight={snapshot.flight}
              following={followIcao24 === snapshot.flight.icao24}
              onToggleFollow={onToggleFollow}
              onToggleFpv={onToggleFpv}
              onClose={() => {
                onCloseFlight();
                onRestoreFocus();
              }}
            />
          </ScrollArea>
        ) : snapshot?.kind === "airport" ? (
          <ScrollArea className="h-full">
            <AirportInfoCard
              board={snapshot.board}
              onSelectFlight={onSelectAirportFlight}
              selectedIcao24={snapshot.selectedIcao24}
              onClose={() => {
                onCloseAirport();
                onRestoreFocus();
              }}
              atc={atc}
            />
          </ScrollArea>
        ) : null}
      </div>
    </aside>
  );
}

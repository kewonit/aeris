"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { BoardFlight } from "@/hooks/use-airport-board";
import { useSettings } from "@/hooks/use-settings";
import { formatVerticalSpeedValue } from "@/lib/unit-formatters";

const ARRIVING = new Set(["Final", "Approach", "Inbound", "Descending"]);
const DEPARTING = new Set(["Departure", "Climbing", "Outbound"]);

function statusTone(status: string): string {
  if (ARRIVING.has(status)) return "text-arrival";
  if (DEPARTING.has(status)) return "text-departure";
  return "text-subtle";
}

function VRate({ rate }: { rate: number | null }) {
  const { settings } = useSettings();
  if (rate === null || !Number.isFinite(rate)) {
    return <span className="text-micro text-subtle">-</span>;
  }
  const vSpeed = formatVerticalSpeedValue(rate, settings.unitSystem);
  if (vSpeed.value === null) {
    return <span className="text-micro text-subtle">-</span>;
  }
  const isMetric = settings.unitSystem === "metric";
  const levelThreshold = isMetric ? 0.5 : 100;
  if (Math.abs(vSpeed.value) < levelThreshold) {
    return <span className="inline-block h-px w-3 bg-border" />;
  }
  const isDown = vSpeed.value < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-micro ${
        isDown ? "text-arrival" : "text-departure"
      }`}
    >
      {isDown ? (
        <ArrowDown className="size-2.5" aria-label="descending" />
      ) : (
        <ArrowUp className="size-2.5" aria-label="climbing" />
      )}
      <span>{Math.abs(vSpeed.value).toLocaleString()}</span>
    </span>
  );
}

function FlightRow({
  flight,
  isSelected,
  onSelect,
}: {
  flight: BoardFlight;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`flex min-h-10 w-full items-center gap-3 rounded-sm px-2 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-card"
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-small text-foreground">
        {flight.callsign}
      </span>
      <span className={`shrink-0 text-label ${statusTone(flight.status)}`}>
        {flight.status}
      </span>
      <span className="hidden w-14 shrink-0 text-right font-mono text-micro text-subtle sm:inline">
        {flight.altitude}
      </span>
      <span className="hidden w-12 shrink-0 justify-end sm:flex">
        <VRate rate={flight.verticalRate} />
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-micro text-subtle">
        {flight.distanceFormatted}
      </span>
    </button>
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
  if (flights.length === 0) {
    return (
      <p className="py-8 text-center text-small text-subtle">
        {emptyMessage ?? "No flights"}
      </p>
    );
  }

  return (
    <div className="-mx-2">
      {flights.map((f) => (
        <FlightRow
          key={f.icao24}
          flight={f}
          isSelected={f.icao24 === selectedIcao24}
          onSelect={() => onSelectFlight(f.icao24)}
        />
      ))}
    </div>
  );
}

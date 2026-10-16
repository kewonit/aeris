"use client";

import type { UnitSystem } from "@/hooks/use-settings";
import { formatElevation } from "./formatters";
import { useClock } from "./use-clock";

type Props = {
  elevationFt: number | null;
  unitSystem: UnitSystem;
  runways: number;
  arrivals: number;
  departures: number;
  overflights: number;
  /** Opens the flight list on arrivals or departures. */
  onShowTraffic: (kind: "arrivals" | "departures") => void;
  activeTraffic: "arrivals" | "departures" | null;
};

/** Airport facts and live traffic counts, laid out like the flight facts. */
export function AirportFacts({
  elevationFt,
  unitSystem,
  runways,
  arrivals,
  departures,
  overflights,
  onShowTraffic,
  activeTraffic,
}: Props) {
  const { utc } = useClock();
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-5 border-y border-border py-5">
      <Fact label="Elevation" value={formatElevation(elevationFt, unitSystem)} />
      <Fact label="UTC" value={utc} mono />
      <Fact label="Runways" value={runways > 0 ? String(runways) : "-"} />
      <TrafficFact
        label="Arrivals"
        count={arrivals}
        tone="text-arrival"
        active={activeTraffic === "arrivals"}
        onSelect={() => onShowTraffic("arrivals")}
      />
      <TrafficFact
        label="Departures"
        count={departures}
        tone="text-departure"
        active={activeTraffic === "departures"}
        onSelect={() => onShowTraffic("departures")}
      />
      <Fact label="Overflights" value={String(overflights)} />
    </dl>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-subtle">{label}</dt>
      <dd
        className={`mt-1 truncate text-foreground ${mono ? "font-mono text-small leading-7" : "text-value"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function TrafficFact({
  label,
  count,
  tone,
  active,
  onSelect,
}: {
  label: string;
  count: number;
  tone: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-subtle">{label}</dt>
      <dd className="mt-1">
        <button
          type="button"
          onClick={onSelect}
          disabled={count === 0}
          aria-pressed={active}
          className={`text-value underline-offset-4 transition-colors hover:underline disabled:no-underline disabled:text-subtle ${tone} ${active ? "underline" : ""}`}
        >
          {count}
        </button>
      </dd>
    </div>
  );
}

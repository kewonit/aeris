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
};

/** Airport facts and live traffic counts, laid out like the flight facts. */
export function AirportFacts({
  elevationFt,
  unitSystem,
  runways,
  arrivals,
  departures,
  overflights,
}: Props) {
  const { utc } = useClock();
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-5 border-y border-border py-5">
      <Fact label="Elevation" value={formatElevation(elevationFt, unitSystem)} />
      <Fact label="UTC" value={utc} mono />
      <Fact label="Runways" value={runways > 0 ? String(runways) : "-"} />
      <Fact label="Arrivals" value={String(arrivals)} tone="text-arrival" />
      <Fact label="Departures" value={String(departures)} tone="text-departure" />
      <Fact label="Overflights" value={String(overflights)} />
    </dl>
  );
}

function Fact({
  label,
  value,
  mono = false,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-subtle">{label}</dt>
      <dd
        className={`mt-1 truncate ${tone} ${mono ? "font-mono text-small leading-7" : "text-value"}`}
      >
        {value}
      </dd>
    </div>
  );
}

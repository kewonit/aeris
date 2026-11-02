"use client";

import type { UnitSystem } from "@/hooks/use-settings";
import { formatElevation } from "./formatters";
import { useClock } from "./use-clock";

type Props = {
  elevationFt: number | null;
  unitSystem: UnitSystem;
  runways: number;
};

/** The airport's fixed facts, laid out like the flight facts. */
export function AirportFacts({
  elevationFt,
  unitSystem,
  runways,
}: Props) {
  const { utc } = useClock();
  return (
    <dl className="grid grid-cols-3 gap-x-4 border-y border-border py-4">
      <Fact label="Elevation" value={formatElevation(elevationFt, unitSystem)} />
      <Fact label="UTC" value={utc} mono />
      <Fact label="Runways" value={runways > 0 ? String(runways) : "-"} />
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
        className={`mt-1 truncate text-foreground ${mono ? "flex h-6.5 items-center font-mono text-small" : "text-value"}`}
      >
        {value}
      </dd>
    </div>
  );
}

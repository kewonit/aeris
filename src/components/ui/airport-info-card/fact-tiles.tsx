"use client";

import { Clock, Mountain } from "lucide-react";
import type { UnitSystem } from "@/hooks/use-settings";
import { formatElevation } from "./formatters";
import { useClock } from "./use-clock";

type Props = {
  elevationFt: number | null;
  unitSystem: UnitSystem;
};

export function FactTiles({ elevationFt, unitSystem }: Props) {
  const { utc, local } = useClock();
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <Tile
        icon={<Mountain className="h-3 w-3" />}
        label="Elev"
        value={formatElevation(elevationFt, unitSystem)}
      />
      <Tile icon={<Clock className="h-3 w-3" />} label="UTC" value={utc} />
      <Tile icon={<Clock className="h-3 w-3" />} label="Local" value={local} />
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-foreground/3 px-2 py-1.5 ring-1 ring-foreground/4">
      <div className="flex items-center gap-1 text-foreground/25">
        {icon}
        <span className="text-[8px] font-medium tracking-widest uppercase">
          {label}
        </span>
      </div>
      <p className="font-mono text-[11px] font-semibold tabular-nums text-foreground/80">
        {value}
      </p>
    </div>
  );
}

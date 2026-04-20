"use client";

import { Plane, PlaneLanding, PlaneTakeoff } from "lucide-react";

type Props = {
  arrivals: number;
  departures: number;
  overflights: number;
  /** When provided, tiles become buttons that jump the user to Flights tab
   *  and set the corresponding Arr/Dep sub-toggle. Overflights is static. */
  onSelectArrivals?: () => void;
  onSelectDepartures?: () => void;
  activeKind?: "arrivals" | "departures" | null;
};

export function TrafficTiles({
  arrivals,
  departures,
  overflights,
  onSelectArrivals,
  onSelectDepartures,
  activeKind,
}: Props) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <Tile
        icon={<PlaneLanding className="h-3 w-3" />}
        label="Arr"
        count={arrivals}
        accent="text-emerald-400"
        activeClass="ring-emerald-400/25 bg-emerald-400/5"
        hoverClass="hover:ring-emerald-400/20 hover:bg-emerald-400/5"
        onClick={arrivals > 0 ? onSelectArrivals : undefined}
        active={activeKind === "arrivals"}
      />
      <Tile
        icon={<PlaneTakeoff className="h-3 w-3" />}
        label="Dep"
        count={departures}
        accent="text-amber-400"
        activeClass="ring-amber-400/25 bg-amber-400/5"
        hoverClass="hover:ring-amber-400/20 hover:bg-amber-400/5"
        onClick={departures > 0 ? onSelectDepartures : undefined}
        active={activeKind === "departures"}
      />
      <Tile
        icon={<Plane className="h-3 w-3" />}
        label="Over"
        count={overflights}
        accent="text-foreground/60"
        activeClass="ring-foreground/10 bg-foreground/4"
        hoverClass=""
      />
    </div>
  );
}

function Tile({
  icon,
  label,
  count,
  accent,
  activeClass,
  hoverClass,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  accent: string;
  activeClass: string;
  hoverClass: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const isButton = typeof onClick === "function";
  const baseClass =
    "flex flex-col gap-0.5 rounded-[10px] px-2 py-1.5 text-left [transition-property:background-color,box-shadow,scale] [transition-duration:180ms]";
  const idleClass = "bg-foreground/3 ring-1 ring-foreground/4";
  const classes = `${baseClass} ${
    active ? `ring-1 ${activeClass}` : idleClass
  } ${isButton ? hoverClass : ""}`.trim();

  const content = (
    <>
      <div className={`flex items-center gap-1 ${accent}`}>
        {icon}
        <span className="text-[8px] font-medium tracking-widest uppercase">
          {label}
        </span>
      </div>
      <p
        className={`font-mono text-[14px] font-semibold tabular-nums ${accent}`}
      >
        {count}
      </p>
    </>
  );

  if (isButton) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={!!active}
        className={`${classes} active:scale-[0.96]`}
      >
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

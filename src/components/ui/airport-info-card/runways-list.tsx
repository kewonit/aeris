"use client";

import type { Runway } from "@/lib/airport-runways";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRunwayLength, surfaceLabel } from "./formatters";

type Props = {
  runways: Runway[];
  metric: boolean;
};

export function RunwaysList({ runways, metric }: Props) {
  if (runways.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-medium tracking-widest text-foreground/25 uppercase">
        Runways
        <span className="ml-1.5 rounded-full bg-foreground/5 px-1.5 py-px text-[9px] font-medium tabular-nums text-foreground/40">
          {runways.length}
        </span>
      </p>
      <ScrollArea className="mt-1.5 max-h-24">
        <div className="space-y-0.5">
          {runways.map((rwy, i) => (
            <div
              key={`${rwy.le_ident}-${rwy.he_ident}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-foreground/3"
            >
              <span className="font-mono font-semibold tabular-nums text-foreground/60">
                {rwy.le_ident}/{rwy.he_ident}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground/35">
                {formatRunwayLength(rwy.length_ft, metric)}
                <span className="ml-1.5 text-foreground/25">
                  {surfaceLabel(rwy.surface)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

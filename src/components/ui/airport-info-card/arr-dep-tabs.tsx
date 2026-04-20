"use client";

import { PlaneLanding, PlaneTakeoff } from "lucide-react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ArrDepTab = "arrivals" | "departures";

type Props = {
  arrivals: number;
  departures: number;
};

export function ArrDepTabs({ arrivals, departures }: Props) {
  return (
    <TabsList className="h-8">
      <TabsTrigger
        value="arrivals"
        className="group gap-1 data-[state=active]:bg-emerald-400/8 data-[state=active]:text-emerald-300 data-[state=active]:ring-emerald-400/20"
      >
        <PlaneLanding className="h-3 w-3 [transition-property:scale,opacity] duration-220 ease-[cubic-bezier(0.2,0,0,1)] group-data-[state=active]:scale-110 group-data-[state=inactive]:opacity-70" />
        <span className="tracking-wide">Arrivals</span>
        <span className="ml-0.5 rounded-full bg-foreground/6 px-1.5 py-px font-mono text-[9px] tabular-nums text-foreground/40 [transition-property:background-color,color] duration-220 group-data-[state=active]:bg-emerald-400/15 group-data-[state=active]:text-emerald-300/90">
          {arrivals}
        </span>
      </TabsTrigger>
      <TabsTrigger
        value="departures"
        className="group gap-1 data-[state=active]:bg-amber-400/8 data-[state=active]:text-amber-300 data-[state=active]:ring-amber-400/20"
      >
        <PlaneTakeoff className="h-3 w-3 [transition-property:scale,opacity] duration-220 ease-[cubic-bezier(0.2,0,0,1)] group-data-[state=active]:scale-110 group-data-[state=inactive]:opacity-70" />
        <span className="tracking-wide">Departures</span>
        <span className="ml-0.5 rounded-full bg-foreground/6 px-1.5 py-px font-mono text-[9px] tabular-nums text-foreground/40 [transition-property:background-color,color] duration-220 group-data-[state=active]:bg-amber-400/15 group-data-[state=active]:text-amber-300/90">
          {departures}
        </span>
      </TabsTrigger>
    </TabsList>
  );
}

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
    <TabsList>
      <TabsTrigger value="arrivals" className="data-[state=active]:text-arrival">
        <PlaneLanding className="size-3.5" aria-hidden="true" />
        Arrivals
        <span className="font-mono text-micro text-subtle">{arrivals}</span>
      </TabsTrigger>
      <TabsTrigger
        value="departures"
        className="data-[state=active]:text-departure"
      >
        <PlaneTakeoff className="size-3.5" aria-hidden="true" />
        Departures
        <span className="font-mono text-micro text-subtle">{departures}</span>
      </TabsTrigger>
    </TabsList>
  );
}

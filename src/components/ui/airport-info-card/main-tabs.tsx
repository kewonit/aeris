"use client";

import type { LucideIcon } from "lucide-react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export type MainTab = "flights" | "weather" | "info";

type Props = {
  tabs: {
    id: MainTab;
    label: string;
    icon: LucideIcon;
    disabled?: boolean;
  }[];
};

export function MainTabs({ tabs }: Props) {
  const enabled = tabs.filter((t) => !t.disabled);
  return (
    <TabsList>
      {enabled.map((tab) => {
        const Icon = tab.icon;
        return (
          <TabsTrigger key={tab.id} value={tab.id}>
            <Icon className="h-3.5 w-3.5 [transition-property:scale,opacity] [transition-duration:220ms] [transition-timing-function:cubic-bezier(0.2,0,0,1)] group-data-[state=active]/tab:scale-110 group-data-[state=inactive]/tab:opacity-70" />
            <span className="tracking-wide">{tab.label}</span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

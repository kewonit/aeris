"use client";

import type { LucideIcon } from "lucide-react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export type MainTab = "flights" | "weather" | "info";

type Props = {
  tabs: { id: MainTab; label: string; icon: LucideIcon }[];
};

export function MainTabs({ tabs }: Props) {
  return (
    <TabsList>
      {tabs.map(({ id, label, icon: Icon }) => (
        <TabsTrigger key={id} value={id}>
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

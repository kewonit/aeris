"use client";

import { memo } from "react";
import { useAircraftFreshness } from "@/hooks/use-aircraft-freshness";
import type { FlightState } from "@/lib/opensky";

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/**
 * "Updated 4 seconds ago from adsb.lol". The only part of the card on a
 * one-second timer, so the rest of the card renders once per update.
 */
export const FreshnessLine = memo(function FreshnessLine({
  provenance,
  sources,
}: {
  provenance: FlightState["provenance"];
  sources: string[];
}) {
  const freshness = useAircraftFreshness(provenance);
  return (
    <p className="text-micro text-subtle">
      {freshness}
      {sources.length > 0 && ` from ${LIST.format(sources)}`}
    </p>
  );
});

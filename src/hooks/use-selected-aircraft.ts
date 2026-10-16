"use client";

import { useEffect, useMemo, useState } from "react";

import type { FlightState } from "@/lib/opensky";
import {
  fuseSelectedAircraft,
  loadSelectedAircraftSources,
  type SelectedAircraftSources,
} from "@/lib/selected-aircraft";

/** Adds a fresh lookup and registry details to the selected aircraft. */
export function useSelectedAircraft(
  current: FlightState | null,
): FlightState | null {
  const [sources, setSources] = useState<SelectedAircraftSources | null>(null);
  const icao24 = current?.icao24 ?? null;

  useEffect(() => {
    if (!icao24) return;
    const controller = new AbortController();
    loadSelectedAircraftSources(icao24, controller.signal).then(
      setSources,
      // Only rejects when this cleanup aborts the request.
      () => {},
    );
    return () => controller.abort();
  }, [icao24]);

  return useMemo(() => {
    if (!current || sources?.icao24 !== current.icao24) return current;
    return fuseSelectedAircraft(current, sources.fresh, sources.registry);
  }, [current, sources]);
}

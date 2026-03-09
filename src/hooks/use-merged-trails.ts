"use client";

import { useMemo } from "react";
import { stitchHistoricalTrail } from "@/lib/trail-stitching";
import type { TrailEntry } from "@/hooks/use-trail-history";
import type { FlightState } from "@/lib/opensky";
import type { FlightTrack } from "@/lib/opensky";

/**
 * Merges the live trail history with a fetched historical track for the
 * currently selected flight, stitching them seamlessly via
 * `stitchHistoricalTrail`.
 */
export function useMergedTrails(
  selectedIcao24: string | null,
  selectedTrack: FlightTrack | null,
  selectedTrackFetchedAtMs: number,
  displayTrails: TrailEntry[],
  displayFlights: FlightState[],
): TrailEntry[] {
  return useMemo(() => {
    if (!selectedIcao24 || !selectedTrack) return displayTrails;

    const flight =
      displayFlights.find((f) => f.icao24 === selectedIcao24) ?? null;

    const livePos: [number, number] | null =
      flight && flight.longitude != null && flight.latitude != null
        ? [flight.longitude, flight.latitude]
        : null;

    const existingTrail =
      displayTrails.find((t) => t.icao24 === selectedIcao24) ?? null;

    const stitchResult = stitchHistoricalTrail(
      selectedTrack,
      existingTrail,
      livePos,
      flight,
      selectedTrackFetchedAtMs,
    );

    if (!stitchResult.valid || stitchResult.path.length < 2) {
      return displayTrails;
    }

    const { path: trackPositions, altitudes: trackAltitudes } = stitchResult;

    const out = displayTrails.map((t) => {
      if (t.icao24 !== selectedIcao24) return t;
      const baroAltitude =
        trackAltitudes[trackAltitudes.length - 1] ?? t.baroAltitude ?? null;
      return {
        ...t,
        path: trackPositions,
        altitudes: trackAltitudes,
        baroAltitude,
        fullHistory: true,
      };
    });

    if (!out.some((t) => t.icao24 === selectedIcao24)) {
      out.push({
        icao24: selectedIcao24,
        path: trackPositions,
        altitudes: trackAltitudes,
        baroAltitude: trackAltitudes[trackAltitudes.length - 1] ?? null,
        fullHistory: true,
      });
    }

    return out;
  }, [
    selectedIcao24,
    selectedTrack,
    selectedTrackFetchedAtMs,
    displayTrails,
    displayFlights,
  ]);
}

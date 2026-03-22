"use client";

import { useMemo, useEffect } from "react";
import {
  stitchHistoricalTrail,
  clearSplinedTrackCache,
} from "@/lib/trail-stitching";
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
  // Extract stable position for the selected flight so that the main memo
  // doesn't depend on the entire displayFlights array (which changes every poll).
  const selectedLivePos = useMemo((): {
    pos: [number, number] | null;
    flight: FlightState | null;
  } => {
    if (!selectedIcao24) return { pos: null, flight: null };
    const flight =
      displayFlights.find((f) => f.icao24 === selectedIcao24) ?? null;
    const pos: [number, number] | null =
      flight && flight.longitude != null && flight.latitude != null
        ? [flight.longitude, flight.latitude]
        : null;
    return { pos, flight };
  }, [selectedIcao24, displayFlights]);

  // Clear the spline cache when the selected flight is deselected or the
  // track is unloaded. This is a side effect (mutates module-level state)
  // so it belongs in useEffect, not useMemo.
  useEffect(() => {
    if (!selectedIcao24 || !selectedTrack) {
      clearSplinedTrackCache();
    }
  }, [selectedIcao24, selectedTrack]);

  return useMemo(() => {
    if (!selectedIcao24 || !selectedTrack) {
      return displayTrails;
    }

    const { pos: livePos, flight } = selectedLivePos;

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
        timestamps: [],
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
    selectedLivePos,
  ]);
}

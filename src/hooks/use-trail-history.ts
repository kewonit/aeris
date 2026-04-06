"use client";

import type { FlightState } from "@/lib/opensky";
import {
  trailStore,
  useTrailStoreSnapshot,
} from "@/lib/trails/store/trail-store";

export type { TrailEntry } from "@/lib/trails/types";

export function useTrailHistory(flights?: FlightState[]) {
  if (flights) {
    trailStore.ingestLiveFlights(flights);
  }

  return useTrailStoreSnapshot((state) => state.trails);
}

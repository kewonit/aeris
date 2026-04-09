"use client";

import { useEffect } from "react";

import type { FlightState } from "@/lib/opensky";
import {
  trailStore,
  useTrailStoreSnapshot,
} from "@/lib/trails/store/trail-store";

export type { TrailEntry } from "@/lib/trails/types";

export function useTrailHistory(flights?: FlightState[]) {
  useEffect(() => {
    if (!flights) {
      return;
    }

    trailStore.ingestLiveFlights(flights);
  }, [flights]);

  return useTrailStoreSnapshot((state) => state.trails);
}

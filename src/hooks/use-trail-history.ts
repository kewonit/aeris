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

    // useFlights only publishes an empty array after its transient-empty guard,
    // so an empty snapshot here is authoritative and should release stale
    // non-selected trail geometry.
    trailStore.ingestLiveFlights(flights, { authoritativeEmpty: true });
  }, [flights]);

  return useTrailStoreSnapshot((state) => state.trails);
}

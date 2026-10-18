"use client";

import { useEffect, useState } from "react";

import { formatAircraftFreshness } from "@/lib/aircraft-sidebar";
import type { FlightState } from "@/lib/opensky";

/** How long ago the aircraft was last seen, counting up every second. */
export function useAircraftFreshness(
  provenance: FlightState["provenance"],
): string {
  const updatedAt = provenance.observationTime ?? provenance.responseTime;
  const [now, setNow] = useState(updatedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return formatAircraftFreshness(updatedAt, now);
}

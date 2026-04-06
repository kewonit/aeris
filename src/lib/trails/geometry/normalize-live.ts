import type { FlightState } from "@/lib/opensky";

import type { TrailSnapshot } from "../types";

export function flightStateToTrailSnapshot(
  flight: FlightState,
  timestamp: number,
): TrailSnapshot | null {
  if (
    flight.longitude == null ||
    flight.latitude == null ||
    !Number.isFinite(flight.longitude) ||
    !Number.isFinite(flight.latitude)
  ) {
    return null;
  }

  return {
    source: "live",
    timestamp,
    lng: flight.longitude,
    lat: flight.latitude,
    altitude:
      flight.baroAltitude != null && Number.isFinite(flight.baroAltitude)
        ? flight.baroAltitude
        : null,
    track:
      flight.trueTrack != null && Number.isFinite(flight.trueTrack)
        ? flight.trueTrack
        : null,
    groundSpeed:
      flight.velocity != null && Number.isFinite(flight.velocity)
        ? flight.velocity
        : null,
    quality: "authoritative-live",
    onGround: flight.onGround,
  };
}

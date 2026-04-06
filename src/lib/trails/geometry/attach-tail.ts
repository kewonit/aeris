import type { TrailSnapshot } from "../types";

export function attachTail(
  samples: TrailSnapshot[],
  aircraft: {
    lng: number;
    lat: number;
    altitude: number | null;
    track: number | null;
    groundSpeed: number | null;
    timestamp: number;
    onGround: boolean;
    source: TrailSnapshot["source"];
  },
): TrailSnapshot[] {
  if (samples.length === 0) {
    return samples;
  }

  const last = samples[samples.length - 1];
  const aircraftAlreadyIncluded =
    last.lng === aircraft.lng &&
    last.lat === aircraft.lat &&
    last.altitude === aircraft.altitude;
  const tail =
    aircraftAlreadyIncluded && samples.length >= 2
      ? samples[samples.length - 2]
      : last;
  const dx = aircraft.lng - tail.lng;
  const dy = aircraft.lat - tail.lat;
  if (dx * dx + dy * dy < 1e-12) {
    return samples;
  }

  const prefix = aircraftAlreadyIncluded ? samples.slice(0, -1) : samples;

  return [
    ...prefix,
    {
      source: aircraft.source,
      timestamp: aircraft.timestamp,
      lng: tail.lng + dx * 0.75,
      lat: tail.lat + dy * 0.75,
      altitude:
        tail.altitude == null || aircraft.altitude == null
          ? null
          : tail.altitude + (aircraft.altitude - tail.altitude) * 0.75,
      track: aircraft.track,
      groundSpeed: aircraft.groundSpeed,
      quality: "derived-anchor",
      onGround: aircraft.onGround,
    },
  ];
}

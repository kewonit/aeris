import type { FlightState } from "@/lib/opensky";

/** Further than this from north, a selected heading of 0 means none. */
const UNSET_HEADING_TRACK_DEG = 20;
/** Reports older than this mean the aircraft is out of reach for now. */
export const SIGNAL_LOST_AFTER_S = 20;

/**
 * The heading the crew selected, or null when there is none. Many
 * transponders send 0 when no heading is selected, so 0 counts only for an
 * aircraft actually flying north.
 */
export function selectedHeading(
  flight: Pick<FlightState, "navHeading" | "trueTrack">,
): number | null {
  const heading = flight.navHeading;
  if (heading == null || !Number.isFinite(heading)) return null;
  const degrees = Math.round(heading) % 360;
  if (degrees !== 0) return degrees;
  const track = flight.trueTrack;
  if (track == null || !Number.isFinite(track)) return null;
  const fromNorth = Math.abs(((track + 540) % 360) - 180);
  return fromNorth > UNSET_HEADING_TRACK_DEG ? null : 0;
}

/** Seconds since the aircraft's position was last observed. */
export function reportAgeSeconds(
  provenance: FlightState["provenance"],
  now: number,
): number {
  const observedAt =
    provenance.observationTime ??
    provenance.responseTime - (provenance.positionAgeSeconds ?? 0) * 1_000;
  return Math.max(0, (now - observedAt) / 1_000);
}

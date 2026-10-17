import { sampleFromFlight } from "@/lib/trails/geometry/trail-parts";
import type { TrailOutcome, TrailSample } from "@/lib/trails/types";

import {
  isRelayObservation,
  isRelayResponseMeta,
  relayObservationToFlightState,
  type RelayHistoryTrack,
  type RelayResponseMeta,
  type RelayTrackResponse,
  type RelayTrailsResponse,
} from "./protocol";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseHistoryTrack(value: unknown): RelayHistoryTrack | null {
  if (!isObject(value)) return null;
  if (
    typeof value.trackId !== "string" ||
    value.trackId.length === 0 ||
    value.trackId.length > 128 ||
    typeof value.address !== "string" ||
    value.address.length === 0 ||
    value.address.length > 32 ||
    typeof value.addressType !== "string" ||
    value.addressType.length === 0 ||
    value.addressType.length > 32 ||
    typeof value.provider !== "string" ||
    value.provider.length === 0 ||
    value.provider.length > 64 ||
    !Array.isArray(value.observations) ||
    value.observations.length > 10_000 ||
    !value.observations.every(isRelayObservation)
  ) {
    return null;
  }
  return value as unknown as RelayHistoryTrack;
}

export function parseRelayTrailsResponse(value: unknown): RelayTrailsResponse | null {
  if (!isObject(value) || !Array.isArray(value.tracks) || value.tracks.length > 10_000) {
    return null;
  }
  const tracks = value.tracks.map(parseHistoryTrack);
  if (
    tracks.some((track) => track === null) ||
    !isRelayResponseMeta(value.meta)
  ) {
    return null;
  }
  return { tracks: tracks as RelayHistoryTrack[], meta: value.meta };
}

export function parseRelayTrackResponse(value: unknown): RelayTrackResponse | null {
  if (!isObject(value) || !isRelayResponseMeta(value.meta)) return null;
  if (value.track === null) return { track: null, meta: value.meta };
  const track = parseHistoryTrack(value.track);
  return track ? { track, meta: value.meta } : null;
}

/**
 * A relay track as trail samples in time order. Each observation goes
 * through the same mapping as live relay flights, so history and live
 * samples carry the same identity and join where the track continues.
 */
export function relayHistoryTrackToSamples(
  track: RelayHistoryTrack,
): TrailSample[] {
  const observations = [...track.observations].sort(
    (left, right) => Date.parse(left.fixTime) - Date.parse(right.fixTime),
  );
  const samples: TrailSample[] = [];
  observations.forEach((observation, index) => {
    const sample = sampleFromFlight(relayObservationToFlightState(observation));
    if (!sample) return;
    // A change of upstream provider is a new track for drawing purposes.
    const previous = observations[index - 1];
    if (previous && previous.provider !== observation.provider) {
      sample.discontinuity = true;
    }
    samples.push(sample);
  });
  return samples;
}

export function relayHistoryOutcome(meta: RelayResponseMeta): TrailOutcome {
  if (!meta.retention) return "partial-history";
  return meta.retention.retentionComplete
    ? "full-history"
    : "partial-history";
}

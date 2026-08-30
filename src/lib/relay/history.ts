import type { FlightTrack } from "@/lib/opensky-types";
import type {
  TrailOutcome,
  TrailSegment,
  TrailSnapshot,
} from "@/lib/trails/types";

import {
  isRelayObservation,
  isRelayResponseMeta,
  type RelayAltitudeReference,
  type RelayHistoryTrack,
  type RelayObservation,
  type RelayResponseMeta,
  type RelayTrackResponse,
  type RelayTrailsResponse,
} from "./protocol";

const FEET_TO_METERS = 0.3048;
const KNOTS_TO_METERS_PER_SECOND = 0.514444;
const MAX_CONTINUOUS_GAP_MS = 30_000;
const MAX_PLAUSIBLE_SPEED_MPS = 450;

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

function selectedAltitudeReference(
  observation: RelayObservation,
): RelayAltitudeReference {
  if (observation.onGround) return "ground";
  if (observation.baroAltitudeFt !== undefined) return "barometric";
  if (observation.geomAltitudeFt !== undefined) return "geometric";
  return observation.altitudeReference;
}

function snapshotFromObservation(observation: RelayObservation): TrailSnapshot {
  const altitudeReference = selectedAltitudeReference(observation);
  const altitudeFeet =
    altitudeReference === "ground"
      ? 0
      : altitudeReference === "barometric"
        ? (observation.baroAltitudeFt ?? null)
        : altitudeReference === "geometric"
          ? (observation.geomAltitudeFt ?? null)
          : null;

  return {
    source: "aeris-relay",
    timestamp: Date.parse(observation.fixTime),
    lng: observation.longitude,
    lat: observation.latitude,
    altitude: altitudeFeet === null ? null : altitudeFeet * FEET_TO_METERS,
    track: observation.trackDeg ?? null,
    groundSpeed:
      observation.groundSpeedKt === undefined
        ? null
        : observation.groundSpeedKt * KNOTS_TO_METERS_PER_SECOND,
    quality: "authoritative-trace",
    onGround: observation.onGround,
    trackId: observation.trackId,
    sourceEpoch: observation.sourceEpoch,
    positionSource: observation.positionSource,
    altitudeReference,
    discontinuity: observation.discontinuity ?? false,
  };
}

function distanceMeters(left: RelayObservation, right: RelayObservation): number {
  const latitude = ((left.latitude + right.latitude) / 2) * (Math.PI / 180);
  let longitudeDelta = right.longitude - left.longitude;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  return Math.hypot(
    longitudeDelta * 111_320 * Math.cos(latitude),
    (right.latitude - left.latitude) * 111_320,
  );
}

export function relayObservationsAreContinuous(
  previous: RelayObservation,
  current: RelayObservation,
): boolean {
  const previousTime = Date.parse(previous.fixTime);
  const currentTime = Date.parse(current.fixTime);
  const elapsedMs = currentTime - previousTime;
  if (
    current.discontinuity ||
    previous.trackId !== current.trackId ||
    previous.provider !== current.provider ||
    previous.sourceEpoch !== current.sourceEpoch ||
    previous.positionSource !== current.positionSource ||
    selectedAltitudeReference(previous) !== selectedAltitudeReference(current) ||
    elapsedMs <= 0 ||
    elapsedMs > MAX_CONTINUOUS_GAP_MS ||
    Math.abs(current.longitude - previous.longitude) > 180
  ) {
    return false;
  }
  return distanceMeters(previous, current) / (elapsedMs / 1000) <= MAX_PLAUSIBLE_SPEED_MPS;
}

export function relayHistoryTrackToSegments(
  track: RelayHistoryTrack,
): TrailSegment[] {
  const observations = [...track.observations].sort(
    (left, right) => Date.parse(left.fixTime) - Date.parse(right.fixTime),
  );
  const groups: RelayObservation[][] = [];
  for (const observation of observations) {
    const current = groups[groups.length - 1];
    if (
      !current ||
      current.length === 0 ||
      !relayObservationsAreContinuous(current[current.length - 1], observation)
    ) {
      groups.push([observation]);
    } else {
      current.push(observation);
    }
  }
  return groups
    .filter((group) => group.length >= 2)
    .map((group) => ({
      kind: "historical" as const,
      provider: "aeris-relay" as const,
      samples: group.map(snapshotFromObservation),
    }));
}

export function relayHistoryOutcome(meta: RelayResponseMeta): TrailOutcome {
  if (!meta.retention) return "partial-history";
  return meta.retention.retentionComplete
    ? "full-history"
    : "partial-history";
}

export function relayHistoryTrackToFlightTrack(
  track: RelayHistoryTrack,
): FlightTrack | null {
  const latestSegment = relayHistoryTrackToSegments(track).at(-1);
  if (!latestSegment) return null;
  const snapshots = latestSegment.samples;
  const latestObservation = track.observations.find(
    (observation) =>
      Date.parse(observation.fixTime) === snapshots[snapshots.length - 1].timestamp,
  );
  return {
    icao24: track.address.toLowerCase(),
    startTime: snapshots[0].timestamp,
    endTime: snapshots[snapshots.length - 1].timestamp,
    callsign: latestObservation?.callsign?.trim() || null,
    path: snapshots.map((snapshot) => ({
      time: snapshot.timestamp,
      latitude: snapshot.lat,
      longitude: snapshot.lng,
      baroAltitude: snapshot.altitude,
      trueTrack: snapshot.track,
      onGround: snapshot.onGround,
    })),
  };
}

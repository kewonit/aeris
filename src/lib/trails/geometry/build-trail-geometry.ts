import type { TrailEntry, TrailEnvelope } from "../types";
import { mergeSegments } from "./merge-segments";
import { filterPositionSpikes, validateSamples } from "./validate-samples";
import type { TrailSnapshot } from "../types";

const MAX_RELAY_CONTINUOUS_SPEED_MPS = 450;

function relayDistanceMeters(
  previous: TrailSnapshot,
  current: TrailSnapshot,
): number {
  const latitude = ((previous.lat + current.lat) / 2) * (Math.PI / 180);
  let longitudeDelta = current.lng - previous.lng;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  return Math.hypot(
    longitudeDelta * 111_320 * Math.cos(latitude),
    (current.lat - previous.lat) * 111_320,
  );
}

function buildEmptyEntry(envelope: TrailEnvelope): TrailEntry {
  return {
    icao24: envelope.icao24,
    path: [],
    altitudes: [],
    timestamps: [],
    baroAltitude: null,
    fullHistory: false,
    provider: envelope.provider ?? "live",
    outcome: envelope.outcome,
    revision: envelope.liveRevision + envelope.historyRevision,
    liveRevision: envelope.liveRevision,
    historyRevision: envelope.historyRevision,
    selectionGeneration: envelope.selectionGeneration,
  };
}

function relaySamplesAreContinuous(
  previous: TrailSnapshot,
  current: TrailSnapshot,
): boolean {
  const elapsedMs = current.timestamp - previous.timestamp;
  if (
    current.discontinuity ||
    previous.trackId !== current.trackId ||
    previous.sourceEpoch !== current.sourceEpoch ||
    previous.positionSource !== current.positionSource ||
    previous.altitudeReference !== current.altitudeReference ||
    elapsedMs <= 0 ||
    elapsedMs > 30_000 ||
    Math.abs(current.lng - previous.lng) > 180
  ) {
    return false;
  }
  return (
    relayDistanceMeters(previous, current) / (elapsedMs / 1_000) <=
    MAX_RELAY_CONTINUOUS_SPEED_MPS
  );
}

function buildRelayTrailGeometry(
  envelope: TrailEnvelope,
  liveTail: TrailSnapshot[],
  historySegments: TrailEnvelope["historySegments"],
): TrailEntry {
  const continuous = historySegments
    .map((segment) => segment.samples)
    .filter((samples) => samples.length > 0)
    .map((samples) => [...samples]);

  if (liveTail.length > 0) {
    const last = continuous[continuous.length - 1];
    if (
      last?.length &&
      relaySamplesAreContinuous(last[last.length - 1], liveTail[0])
    ) {
      const lastTimestamp = last[last.length - 1].timestamp;
      last.push(...liveTail.filter((sample) => sample.timestamp > lastTimestamp));
    } else {
      continuous.push([...liveTail]);
    }
  }

  const renderSegments = continuous
    .filter((samples) => samples.length >= 2)
    .map((samples) => ({
      path: samples.map((sample) => [sample.lng, sample.lat] as [number, number]),
      altitudes: samples.map((sample) => sample.altitude),
      timestamps: samples.map((sample) => sample.timestamp),
    }));
  const latest = renderSegments[renderSegments.length - 1];
  if (!latest) return buildEmptyEntry(envelope);

  return {
    icao24: envelope.icao24,
    path: latest.path,
    altitudes: latest.altitudes,
    timestamps: latest.timestamps,
    baroAltitude: latest.altitudes[latest.altitudes.length - 1] ?? null,
    fullHistory:
      historySegments.length > 0 && envelope.outcome === "full-history",
    provider: "aeris-relay",
    outcome: envelope.outcome,
    revision: envelope.liveRevision + envelope.historyRevision,
    liveRevision: envelope.liveRevision,
    historyRevision: envelope.historyRevision,
    selectionGeneration: envelope.selectionGeneration,
    renderSegments,
  };
}

export function buildTrailGeometry(envelope: TrailEnvelope): TrailEntry {
  const liveTail = validateSamples(envelope.liveTail);
  const isRelay =
    envelope.provider === "aeris-relay" ||
    envelope.historySegments.some(
      (segment) => segment.provider === "aeris-relay",
    );
  const historySegments = envelope.historySegments
    .map((segment) => ({
      ...segment,
      samples: isRelay
        ? validateSamples(segment.samples)
        : filterPositionSpikes(validateSamples(segment.samples)),
    }))
    .filter((segment) => segment.samples.length > 0);

  if (isRelay) {
    return buildRelayTrailGeometry(envelope, liveTail, historySegments);
  }

  if (liveTail.length === 0 && historySegments.length === 0) {
    return buildEmptyEntry(envelope);
  }

  const merged = mergeSegments({
    liveTail,
    historySegments,
    referenceAltitude: liveTail[liveTail.length - 1]?.altitude ?? null,
  });

  if (merged.samples.length === 0) {
    return buildEmptyEntry(envelope);
  }

  const hasHistory = historySegments.some(
    (segment) => segment.samples.length > 0,
  );

  return {
    icao24: envelope.icao24,
    path: merged.samples.map((sample) => [sample.lng, sample.lat]),
    altitudes: merged.samples.map((sample) => sample.altitude),
    timestamps: merged.samples.map((sample) => sample.timestamp),
    baroAltitude: merged.samples[merged.samples.length - 1]?.altitude ?? null,
    fullHistory: hasHistory && merged.outcome !== "live-tail-only",
    provider: hasHistory
      ? (envelope.provider ?? historySegments[0]?.provider ?? "live")
      : "live",
    outcome: merged.outcome,
    revision: envelope.liveRevision + envelope.historyRevision,
    liveRevision: envelope.liveRevision,
    historyRevision: envelope.historyRevision,
    selectionGeneration: envelope.selectionGeneration,
  };
}

import type { TrailEntry, TrailEnvelope } from "../types";
import { mergeSegments } from "./merge-segments";
import { filterPositionSpikes, validateSamples } from "./validate-samples";

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

export function buildTrailGeometry(envelope: TrailEnvelope): TrailEntry {
  const liveTail = validateSamples(envelope.liveTail);
  const historySegments = envelope.historySegments
    .map((segment) => ({
      ...segment,
      samples: filterPositionSpikes(validateSamples(segment.samples)),
    }))
    .filter((segment) => segment.samples.length > 0);

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

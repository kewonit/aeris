import type { TrailOutcome, TrailProviderId } from "./types";

export function makeHistoryRequestKey(params: {
  icao24: string;
  provider: TrailProviderId;
  mode: "full" | "recent";
  selectionGeneration: number;
}): string {
  return [
    params.icao24.trim().toLowerCase(),
    params.provider,
    params.mode,
    params.selectionGeneration,
  ].join("|");
}

export function makeGeometryCacheKey(params: {
  icao24: string;
  provider: TrailProviderId | null;
  selectionGeneration: number;
  liveRevision: number;
  historyRevision: number;
  outcome: TrailOutcome;
}): string {
  return [
    params.icao24.trim().toLowerCase(),
    params.provider ?? "none",
    params.selectionGeneration,
    params.liveRevision,
    params.historyRevision,
    params.outcome,
  ].join("|");
}

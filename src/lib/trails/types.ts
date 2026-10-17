export type TrailProviderId =
  | "live"
  | "adsb-fi"
  | "adsb-lol"
  | "airplanes-live"
  | "opensky";

export type TrailOutcome =
  | "full-history"
  | "partial-history"
  | "live-tail-only"
  | "rate-limited"
  | "provider-unavailable";

/** One observed position. */
export type TrailSample = {
  /** Unix milliseconds of the observation. */
  t: number;
  lng: number;
  lat: number;
  /** Barometric altitude in meters, or null when unknown. */
  alt: number | null;
  onGround: boolean;
};

/**
 * The trail of one aircraft as continuous parts, oldest first. A renderer
 * must never draw a line between two parts.
 */
export type TrailTrack = {
  icao24: string;
  parts: TrailSample[][];
  /** Changes whenever `parts` changes, so geometry can be cached on it. */
  revision: number;
  /** True when the parts include fetched history. */
  hasHistory: boolean;
};

export type TrailHistoryState = {
  selectedIcao24: string | null;
  selectionGeneration: number;
  loading: boolean;
  provider: TrailProviderId | null;
  outcome: TrailOutcome | null;
  cooldownUntil: number;
  creditsRemaining: number | null;
};

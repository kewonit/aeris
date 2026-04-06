export type TrailProviderId =
  | "live"
  | "adsb-fi"
  | "adsb-lol"
  | "airplanes-live"
  | "opensky";

export type TrailSampleQuality =
  | "authoritative-live"
  | "authoritative-trace"
  | "interpolated-bridge"
  | "derived-anchor"
  | "suspect";

export type TrailOutcome =
  | "full-history"
  | "partial-history"
  | "live-tail-only"
  | "rate-limited"
  | "provider-unavailable";

export type TrailSnapshot = {
  source: TrailProviderId;
  timestamp: number;
  lng: number;
  lat: number;
  altitude: number | null;
  track: number | null;
  groundSpeed: number | null;
  quality: TrailSampleQuality;
  onGround: boolean;
};

export type TrailSegmentKind = "live" | "historical" | "bridge";

export type TrailSegment = {
  kind: TrailSegmentKind;
  provider: TrailProviderId;
  samples: TrailSnapshot[];
};

export type TrailMetadata = {
  provider?: TrailProviderId | null;
  outcome?: TrailOutcome;
  revision?: number;
  liveRevision?: number;
  historyRevision?: number;
  selectionGeneration?: number;
};

export type TrailEntry = {
  icao24: string;
  path: [number, number][];
  altitudes: Array<number | null>;
  timestamps: number[];
  baroAltitude: number | null;
  fullHistory?: boolean;
} & TrailMetadata;

export type TrailHistoryState = {
  selectedIcao24: string | null;
  selectionGeneration: number;
  loading: boolean;
  provider: TrailProviderId | null;
  outcome: TrailOutcome | null;
  cooldownUntil: number;
  creditsRemaining: number | null;
  missingSinceMs: number | null;
};

export type TrailGeometry = TrailEntry & {
  anchorIndex?: number;
};

export type TrailEnvelope = {
  icao24: string;
  provider: TrailProviderId | null;
  outcome: TrailOutcome;
  selectionGeneration: number;
  liveRevision: number;
  historyRevision: number;
  lastSeenAt: number;
  liveTail: TrailSnapshot[];
  historySegments: TrailSegment[];
  entry: TrailGeometry | null;
};

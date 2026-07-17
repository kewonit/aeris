// ── ATC Feed Types ─────────────────────────────────────────────────────

/**
 * Feed type classification matching aviation ATC frequency assignments.
 * Used for sorting feeds by relevance (tower > approach > ground > etc).
 */
export type AtcFeedType =
  | "tower"
  | "ground"
  | "approach"
  | "departure"
  | "atis"
  | "center"
  | "combined";

/**
 * A logical ATC channel. Physical audio sources are resolved separately so a
 * channel can fail over between providers without changing its stable ID.
 */
export interface AtcFeed {
  /** Unique feed identifier (e.g., "kjfk-twr") */
  id: string;
  /** Airport ICAO code (e.g., "KJFK") */
  icao: string;
  /** Display name (e.g., "JFK Tower") */
  name: string;
  /** Frequency string (e.g., "119.100") */
  frequency: string;
  /** Feed type classification */
  type: AtcFeedType;
}

/** Public attribution details for an ATC audio provider. */
export interface AtcProviderAttribution {
  /** Stable provider identifier. */
  id: string;
  /** Human-readable provider label. */
  label: string;
  /** Provider page that must be linked from attribution UI. */
  attributionUrl: string;
}

/** A browser-playable source candidate for one logical ATC channel. */
export interface AtcSourceCandidate {
  /** Opaque source identifier accepted by /api/atc/stream. */
  id: string;
  /** Stable logical feed ID this candidate can play. */
  feedId: string;
  /** Provider identifier. */
  providerId: string;
  /** Human-readable provider label. */
  providerLabel: string;
  /** Provider page used for attribution. */
  attributionUrl: string;
  /** Lower values are attempted first. */
  priority: number;
  /** Whether the source permits cross-origin Web Audio analysis. */
  analyzable: boolean;
  /** Same-origin resolver or relay endpoint used for playback. */
  playbackUrl: string;
}

/** Client-safe source manifest returned by /api/atc/sources. */
export interface AtcSourcesManifest {
  providers: AtcProviderAttribution[];
  sourcesByFeed: Record<string, AtcSourceCandidate[]>;
}

/**
 * Stream playback status.
 */
export type AtcStreamStatus =
  | "idle"
  | "loading"
  | "switching"
  | "reconnecting"
  | "playing"
  | "error"
  | "blocked";

/**
 * Full state of the ATC audio stream.
 */
export interface AtcStreamState {
  /** User-selected logical feed, or null if nothing is requested. */
  feed: AtcFeed | null;
  /** Feed currently playing, which may be an automatic facility backup. */
  activeFeed: AtcFeed | null;
  /** Opaque ID of the physical source currently in use. */
  activeSourceId: string | null;
  /** Current playback status */
  status: AtcStreamStatus;
  /** Whether playback is moving to another source or facility backup. */
  switching: boolean;
  /** Whether playback is waiting to recover the current session. */
  reconnecting: boolean;
  /** Volume level 0–1 */
  volume: number;
  /** Error message when status is 'error' or 'blocked' */
  error?: string;
  /** Earliest automatic retry time after all candidates enter cooldown. */
  retryAt: number | null;
  /** Whether activeFeed differs from the user-selected feed. */
  isBackup: boolean;
  /** Whether Web Audio visualizations are supported by the active source. */
  analyzable: boolean;
}

/**
 * Feed type priority for sorting (lower = higher priority).
 */
export const FEED_TYPE_PRIORITY: Record<AtcFeedType, number> = {
  tower: 0,
  approach: 1,
  ground: 2,
  departure: 3,
  combined: 4,
  center: 5,
  atis: 6,
};

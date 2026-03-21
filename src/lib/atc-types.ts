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
 * A single ATC audio feed from LiveATC.
 * Mount points and stream URLs are sourced from LiveATC's public feed list.
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
  /** LiveATC mount point identifier (e.g., "kjfk_twr") */
  mountPoint: string;
  /** Direct Icecast stream URL for <audio> src */
  streamUrl: string;
}

/**
 * Stream playback status.
 */
export type AtcStreamStatus =
  | "idle"
  | "loading"
  | "playing"
  | "error"
  | "blocked";

/**
 * Full state of the ATC audio stream.
 */
export interface AtcStreamState {
  /** Currently active feed, or null if nothing selected */
  feed: AtcFeed | null;
  /** Current playback status */
  status: AtcStreamStatus;
  /** Volume level 0–1 */
  volume: number;
  /** Error message when status is 'error' or 'blocked' */
  error?: string;
  /** Whether the fallback proxy is being used */
  usingProxy: boolean;
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

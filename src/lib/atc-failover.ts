import type { AtcFeed, AtcSourceCandidate } from "./atc-types";

export const ATC_SOURCE_COOLDOWNS_MS = [
  30_000,
  60_000,
  120_000,
  300_000,
] as const;

export const ATC_STABLE_PLAYBACK_MS = 30_000;

export interface AtcPlaybackCandidate {
  /** Logical channel represented by this source. */
  feed: AtcFeed;
  /** Physical provider source to connect to. */
  source: AtcSourceCandidate;
  /** True only when playback moved to a different logical channel. */
  isBackup: boolean;
}

export interface AtcPlaybackPlan {
  requestedFeed: AtcFeed;
  candidates: AtcPlaybackCandidate[];
}

export interface AtcSourceHealth {
  failureStreak: number;
  cooldownUntil: number;
}

export type AtcSourceHealthById = Readonly<
  Record<string, AtcSourceHealth | undefined>
>;

export interface AtcPlaybackSelection {
  candidate: AtcPlaybackCandidate | null;
  /** Earliest time another attempt can be made when every source is cooling. */
  retryAt: number | null;
}

type SourcesByFeed = Readonly<
  Record<string, readonly AtcSourceCandidate[] | undefined>
>;

/**
 * Builds the deterministic attempt order for one user-selected logical feed.
 *
 * Sources for the requested feed come first. They are followed by other feeds
 * of the same facility type at the same airport, then combined feeds at that
 * airport. A physical source ID is emitted only once, at its earliest valid
 * position in the plan.
 */
export function buildAtcPlaybackPlan(
  requestedFeed: AtcFeed,
  catalog: readonly AtcFeed[],
  sourcesByFeed: SourcesByFeed,
): AtcPlaybackPlan {
  const requestedIcao = requestedFeed.icao.toUpperCase();
  const orderedFeeds: AtcFeed[] = [];
  const includedFeedIds = new Set<string>();

  const includeFeed = (feed: AtcFeed) => {
    if (includedFeedIds.has(feed.id)) {
      return;
    }

    includedFeedIds.add(feed.id);
    orderedFeeds.push(feed);
  };

  includeFeed(requestedFeed);

  for (const feed of catalog) {
    if (
      feed.icao.toUpperCase() === requestedIcao &&
      feed.type === requestedFeed.type
    ) {
      includeFeed(feed);
    }
  }

  for (const feed of catalog) {
    if (
      feed.icao.toUpperCase() === requestedIcao &&
      feed.type === "combined"
    ) {
      includeFeed(feed);
    }
  }

  const candidates: AtcPlaybackCandidate[] = [];
  const includedSourceIds = new Set<string>();

  for (const feed of orderedFeeds) {
    const sortedSources = (sourcesByFeed[feed.id] ?? [])
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => source.feedId === feed.id)
      .sort(
        (left, right) =>
          left.source.priority - right.source.priority ||
          left.index - right.index,
      );

    for (const { source } of sortedSources) {
      if (includedSourceIds.has(source.id)) {
        continue;
      }

      includedSourceIds.add(source.id);
      candidates.push({
        feed,
        source,
        isBackup: feed.id !== requestedFeed.id,
      });
    }
  }

  return { requestedFeed, candidates };
}

export function getAtcSourceCooldownMs(failureStreak: number): number {
  if (failureStreak <= 0) {
    return 0;
  }

  const index = Math.min(
    Math.floor(failureStreak) - 1,
    ATC_SOURCE_COOLDOWNS_MS.length - 1,
  );

  return ATC_SOURCE_COOLDOWNS_MS[index];
}

/** Records a source failure without mutating the previous health state. */
export function recordAtcSourceFailure(
  healthBySource: AtcSourceHealthById,
  sourceId: string,
  now: number,
): AtcSourceHealthById {
  const previous = healthBySource[sourceId];
  const failureStreak = (previous?.failureStreak ?? 0) + 1;

  return {
    ...healthBySource,
    [sourceId]: {
      failureStreak,
      cooldownUntil: now + getAtcSourceCooldownMs(failureStreak),
    },
  };
}

/**
 * Clears a failure streak only after the source has played continuously for
 * the stability window. Calling this before then is intentionally a no-op.
 */
export function recordAtcSourceStableSuccess(
  healthBySource: AtcSourceHealthById,
  sourceId: string,
  stableForMs: number,
): AtcSourceHealthById {
  const previous = healthBySource[sourceId];

  if (
    stableForMs < ATC_STABLE_PLAYBACK_MS ||
    !previous ||
    (previous.failureStreak === 0 && previous.cooldownUntil === 0)
  ) {
    return healthBySource;
  }

  return {
    ...healthBySource,
    [sourceId]: {
      failureStreak: 0,
      cooldownUntil: 0,
    },
  };
}

/**
 * Returns the next useful retry time only when every candidate is cooling.
 * If any source is eligible now, no retry timer is needed.
 */
export function getEarliestAtcRetryAt(
  plan: AtcPlaybackPlan,
  healthBySource: AtcSourceHealthById,
  now: number,
): number | null {
  let earliestRetryAt: number | null = null;

  for (const candidate of plan.candidates) {
    const cooldownUntil =
      healthBySource[candidate.source.id]?.cooldownUntil ?? 0;

    if (cooldownUntil <= now) {
      return null;
    }

    earliestRetryAt =
      earliestRetryAt === null
        ? cooldownUntil
        : Math.min(earliestRetryAt, cooldownUntil);
  }

  return earliestRetryAt;
}

/** Selects the first eligible source in the plan without mutating health. */
export function selectAtcPlaybackCandidate(
  plan: AtcPlaybackPlan,
  healthBySource: AtcSourceHealthById,
  now: number,
): AtcPlaybackSelection {
  const candidate =
    plan.candidates.find(
      (entry) =>
        (healthBySource[entry.source.id]?.cooldownUntil ?? 0) <= now,
    ) ?? null;

  if (candidate) {
    return { candidate, retryAt: null };
  }

  return {
    candidate: null,
    retryAt: getEarliestAtcRetryAt(plan, healthBySource, now),
  };
}

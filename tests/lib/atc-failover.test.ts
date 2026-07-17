import assert from "node:assert/strict";
import test from "node:test";

import type { AtcFeed, AtcSourceCandidate } from "@/lib/atc-types";
import {
  ATC_STABLE_PLAYBACK_MS,
  buildAtcPlaybackPlan,
  getAtcSourceCooldownMs,
  getEarliestAtcRetryAt,
  recordAtcSourceFailure,
  recordAtcSourceStableSuccess,
  selectAtcPlaybackCandidate,
  type AtcSourceHealthById,
} from "@/lib/atc-failover";

function feed(
  id: string,
  icao: string,
  type: AtcFeed["type"],
): AtcFeed {
  return {
    id,
    icao,
    type,
    name: id,
    frequency: "123.450",
  };
}

function source(
  id: string,
  feedId: string,
  priority: number,
): AtcSourceCandidate {
  return {
    id,
    feedId,
    priority,
    providerId: "test",
    providerLabel: "Test Provider",
    attributionUrl: "https://example.com",
    analyzable: true,
    playbackUrl: `/api/atc/stream?source=${id}`,
  };
}

test("builds exact, same-type, then combined candidates without facility drift", () => {
  const requested = feed("kjfk-tower", "KJFK", "tower");
  const sameType = feed("kjfk-tower-south", "KJFK", "tower");
  const unrelatedType = feed("kjfk-ground", "KJFK", "ground");
  const combined = feed("kjfk-combined", "KJFK", "combined");
  const otherAirport = feed("klax-tower", "KLAX", "tower");

  const plan = buildAtcPlaybackPlan(
    requested,
    [
      unrelatedType,
      requested,
      sameType,
      otherAirport,
      combined,
    ],
    {
      [requested.id]: [
        source("exact-100", requested.id, 100),
        source("exact-10-a", requested.id, 10),
        source("exact-10-b", requested.id, 10),
      ],
      [sameType.id]: [source("same-type", sameType.id, 1)],
      [unrelatedType.id]: [source("wrong-type", unrelatedType.id, 1)],
      [combined.id]: [source("combined", combined.id, 1)],
      [otherAirport.id]: [source("wrong-airport", otherAirport.id, 1)],
    },
  );

  assert.equal(plan.requestedFeed, requested);
  assert.deepEqual(
    plan.candidates.map(({ feed: activeFeed, source: activeSource }) => [
      activeFeed.id,
      activeSource.id,
    ]),
    [
      [requested.id, "exact-10-a"],
      [requested.id, "exact-10-b"],
      [requested.id, "exact-100"],
      [sameType.id, "same-type"],
      [combined.id, "combined"],
    ],
  );
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.isBackup),
    [false, false, false, true, true],
  );
});

test("keeps catalog order between fallback feeds and ignores mismatched mappings", () => {
  const requested = feed("kjfk-tower", "kjfk", "tower");
  const second = feed("kjfk-tower-2", "KJFK", "tower");
  const third = feed("kjfk-tower-3", "KJFK", "tower");
  const mismatched = source("mismatched", requested.id, 1);

  const plan = buildAtcPlaybackPlan(
    requested,
    [third, second],
    {
      [requested.id]: [],
      [third.id]: [source("third", third.id, 100)],
      [second.id]: [source("second", second.id, 1), mismatched],
    },
  );

  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.source.id),
    ["third", "second"],
  );
});

test("emits a physical source only once at its earliest plan position", () => {
  const requested = feed("kjfk-tower", "KJFK", "tower");
  const backup = feed("kjfk-tower-2", "KJFK", "tower");
  const sharedForRequested = source("shared", requested.id, 100);
  const sharedForBackup = source("shared", backup.id, 1);

  const plan = buildAtcPlaybackPlan(requested, [backup], {
    [requested.id]: [sharedForRequested],
    [backup.id]: [sharedForBackup, source("backup-only", backup.id, 2)],
  });

  assert.deepEqual(
    plan.candidates.map((candidate) => [
      candidate.feed.id,
      candidate.source.id,
    ]),
    [
      [requested.id, "shared"],
      [backup.id, "backup-only"],
    ],
  );
});

test("cooldown escalates through 30, 60, 120, then 300 seconds", () => {
  assert.equal(getAtcSourceCooldownMs(0), 0);
  assert.equal(getAtcSourceCooldownMs(1), 30_000);
  assert.equal(getAtcSourceCooldownMs(2), 60_000);
  assert.equal(getAtcSourceCooldownMs(3), 120_000);
  assert.equal(getAtcSourceCooldownMs(4), 300_000);
  assert.equal(getAtcSourceCooldownMs(20), 300_000);

  let health: AtcSourceHealthById = {};
  const failureTimes = [1_000, 40_000, 110_000, 240_000, 600_000];
  const expectedCooldowns = [31_000, 100_000, 230_000, 540_000, 900_000];

  for (const [index, now] of failureTimes.entries()) {
    health = recordAtcSourceFailure(health, "primary", now);
    assert.equal(health.primary?.failureStreak, index + 1);
    assert.equal(health.primary?.cooldownUntil, expectedCooldowns[index]);
  }
});

test("stable success resets health only after 30 seconds", () => {
  const failed = recordAtcSourceFailure({}, "primary", 1_000);
  const premature = recordAtcSourceStableSuccess(
    failed,
    "primary",
    ATC_STABLE_PLAYBACK_MS - 1,
  );

  assert.equal(premature, failed);
  assert.equal(premature.primary?.failureStreak, 1);

  const recovered = recordAtcSourceStableSuccess(
    premature,
    "primary",
    ATC_STABLE_PLAYBACK_MS,
  );

  assert.deepEqual(recovered.primary, {
    failureStreak: 0,
    cooldownUntil: 0,
  });
  assert.deepEqual(failed.primary, {
    failureStreak: 1,
    cooldownUntil: 31_000,
  });
});

test("selection skips cooling sources and returns the full active entry", () => {
  const requested = feed("kjfk-tower", "KJFK", "tower");
  const backup = feed("kjfk-tower-2", "KJFK", "tower");
  const plan = buildAtcPlaybackPlan(requested, [backup], {
    [requested.id]: [source("primary", requested.id, 100)],
    [backup.id]: [source("fallback", backup.id, 100)],
  });
  const health: AtcSourceHealthById = {
    primary: { failureStreak: 1, cooldownUntil: 31_000 },
  };

  const selection = selectAtcPlaybackCandidate(plan, health, 1_000);

  assert.equal(selection.retryAt, null);
  assert.equal(selection.candidate?.source.id, "fallback");
  assert.equal(selection.candidate?.feed, backup);
  assert.equal(selection.candidate?.isBackup, true);
});

test("selection reports the earliest retry when every source is cooling", () => {
  const requested = feed("kjfk-tower", "KJFK", "tower");
  const plan = buildAtcPlaybackPlan(requested, [], {
    [requested.id]: [
      source("primary", requested.id, 1),
      source("secondary", requested.id, 2),
    ],
  });
  const health: AtcSourceHealthById = {
    primary: { failureStreak: 2, cooldownUntil: 61_000 },
    secondary: { failureStreak: 1, cooldownUntil: 31_000 },
  };

  assert.equal(getEarliestAtcRetryAt(plan, health, 1_000), 31_000);
  assert.deepEqual(selectAtcPlaybackCandidate(plan, health, 1_000), {
    candidate: null,
    retryAt: 31_000,
  });

  const retried = selectAtcPlaybackCandidate(plan, health, 31_000);
  assert.equal(retried.candidate?.source.id, "secondary");
  assert.equal(retried.retryAt, null);
  assert.equal(getEarliestAtcRetryAt(plan, health, 31_000), null);
});

test("an empty playback plan has neither a candidate nor retry timer", () => {
  const requested = feed("kjfk-tower", "KJFK", "tower");
  const plan = buildAtcPlaybackPlan(requested, [], {});

  assert.deepEqual(selectAtcPlaybackCandidate(plan, {}, 1_000), {
    candidate: null,
    retryAt: null,
  });
});

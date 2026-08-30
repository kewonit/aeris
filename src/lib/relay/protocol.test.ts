import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRelayStreamMessage,
  createRelayClientState,
  parseRelayStreamMessage,
  relayBoundingBoxAround,
  relayStateToFlights,
  type RelayObservation,
  type RelayStreamMessage,
} from "./protocol";

function observation(
  trackId: string,
  overrides: Partial<RelayObservation> = {},
): RelayObservation {
  return {
    trackId,
    provider: "synthetic",
    sourceEpoch: "epoch-a",
    sessionGeneration: 1,
    address: "abc123",
    addressType: "icao",
    fixTime: "2026-08-30T00:00:00.000Z",
    receivedAt: "2026-08-30T00:00:00.100Z",
    publishedAt: "2026-08-30T00:00:00.200Z",
    latitude: 12.5,
    longitude: 77.6,
    baroAltitudeFt: 30_000,
    altitudeReference: "barometric",
    onGround: false,
    trackDeg: 90,
    groundSpeedKt: 400,
    verticalRateFpm: 0,
    positionSource: "adsb_icao",
    ...overrides,
  };
}

function message(
  type: RelayStreamMessage["type"],
  overrides: Partial<RelayStreamMessage> = {},
): RelayStreamMessage {
  return {
    type,
    protocolVersion: 1,
    serverEpoch: "server-a",
    subscriptionRevision: 1,
    sequence: 10,
    asOf: "2026-08-30T00:00:01.000Z",
    sourceStatus: "live",
    ...overrides,
  };
}

test("snapshot-first state ignores older revisions and accepts ordered sparse sequences", () => {
  const first = applyRelayStreamMessage(
    createRelayClientState(),
    message("snapshot", { aircraft: [observation("track-a")] }),
    1,
  );
  assert.equal(first.hasSnapshot, true);
  assert.equal(first.aircraft.size, 1);

  const ignored = applyRelayStreamMessage(
    first,
    message("delta", {
      subscriptionRevision: 1,
      sequence: 11,
      upserts: [observation("old-revision")],
    }),
    2,
  );
  assert.equal(ignored, first);

  const replacement = applyRelayStreamMessage(
    first,
    message("snapshot", {
      subscriptionRevision: 2,
      sequence: 12,
      aircraft: [observation("track-b")],
    }),
    2,
  );
  assert.deepEqual([...replacement.aircraft.keys()], ["track-b"]);

  const delta = applyRelayStreamMessage(
    replacement,
    message("delta", {
      subscriptionRevision: 2,
      sequence: 20,
      removals: ["track-b"],
      upserts: [observation("track-c")],
    }),
    2,
  );
  assert.deepEqual([...delta.aircraft.keys()], ["track-c"]);
  assert.equal(delta.needsResnapshot, false);
});

test("a non-snapshot server epoch change requires a fresh snapshot", () => {
  const state = applyRelayStreamMessage(
    createRelayClientState(),
    message("snapshot", { aircraft: [observation("track-a")] }),
    1,
  );
  const changed = applyRelayStreamMessage(
    state,
    message("source_status", {
      serverEpoch: "server-b",
      sequence: 11,
      sourceStatus: "stale",
    }),
    1,
  );
  assert.equal(changed.needsResnapshot, true);
  assert.equal(changed.aircraft.size, 1);
});

test("protocol parsing rejects malformed observations and oversized revisions", () => {
  assert.equal(
    parseRelayStreamMessage({
      ...message("snapshot"),
      aircraft: [{ ...observation("bad"), latitude: 91 }],
    }),
    null,
  );
  assert.equal(
    parseRelayStreamMessage({
      ...message("snapshot"),
      subscriptionRevision: Number.MAX_SAFE_INTEGER + 1,
      aircraft: [],
    }),
    null,
  );
  assert.equal(
    parseRelayStreamMessage({
      ...message("snapshot"),
      aircraft: [{ ...observation("bad-altitude"), baroAltitudeFt: 1_000_000 }],
    }),
    null,
  );
  assert.equal(
    parseRelayStreamMessage({
      ...message("snapshot"),
      aircraft: [
        {
          ...observation("bad-time"),
          publishedAt: "2026-08-29T23:59:59.000Z",
        },
      ],
    }),
    null,
  );
});

test("display conversion keeps only the newest session per address and retains track identity", () => {
  const aircraft = new Map([
    ["old", observation("old")],
    [
      "new",
      observation("new", {
        receivedAt: "2026-08-30T00:00:02.000Z",
        fixTime: "2026-08-30T00:00:01.900Z",
      }),
    ],
  ]);
  const flights = relayStateToFlights(aircraft);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].trackId, "new");
  assert.equal(flights[0].altitudeReference, "barometric");
  assert.equal(flights[0].provenance.positionProvider, "aeris-relay");
});

test("viewport boxes remain within relay area bounds near the poles", () => {
  const bbox = relayBoundingBoxAround(88, 179, 4.9);
  const width = bbox.east >= bbox.west
    ? bbox.east - bbox.west
    : bbox.east - bbox.west + 360;
  assert.ok(width * (bbox.north - bbox.south) <= 100.000001);
});

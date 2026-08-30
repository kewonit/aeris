import assert from "node:assert/strict";
import test from "node:test";

import { buildTrailGeometry } from "@/lib/trails/geometry/build-trail-geometry";
import { buildTrailDisplayGeometry } from "@/components/map/trail-display-geometry";
import type { TrailEnvelope } from "@/lib/trails/types";

import {
  parseRelayTrackResponse,
  relayHistoryOutcome,
  relayHistoryTrackToFlightTrack,
  relayHistoryTrackToSegments,
} from "./history";
import type { RelayHistoryTrack, RelayObservation } from "./protocol";

function fix(
  seconds: number,
  longitude: number,
  overrides: Partial<RelayObservation> = {},
): RelayObservation {
  const time = new Date(Date.UTC(2026, 7, 30, 0, 0, seconds)).toISOString();
  return {
    trackId: "track-a",
    provider: "synthetic",
    sourceEpoch: "epoch-a",
    sessionGeneration: 1,
    address: "abc123",
    addressType: "icao",
    fixTime: time,
    receivedAt: time,
    publishedAt: time,
    latitude: 10 + seconds * 0.001,
    longitude,
    baroAltitudeFt: 10_000 + seconds * 10,
    altitudeReference: "barometric",
    onGround: false,
    positionSource: "adsb_icao",
    ...overrides,
  };
}

function track(observations: RelayObservation[]): RelayHistoryTrack {
  return {
    trackId: "track-a",
    address: "abc123",
    addressType: "icao",
    provider: "synthetic",
    observations,
  };
}

test("relay history breaks on datum, source, gap, and antimeridian boundaries", () => {
  const segments = relayHistoryTrackToSegments(
    track([
      fix(0, 10),
      fix(5, 10.01),
      fix(10, 10.02, {
        baroAltitudeFt: undefined,
        geomAltitudeFt: 10_200,
        altitudeReference: "geometric",
      }),
      fix(15, 10.03, {
        baroAltitudeFt: undefined,
        geomAltitudeFt: 10_250,
        altitudeReference: "geometric",
      }),
      fix(20, 179.9, { sourceEpoch: "epoch-b" }),
      fix(25, -179.9, { sourceEpoch: "epoch-b" }),
      fix(55, -179.8, { sourceEpoch: "epoch-b" }),
      fix(59, -179.79, { sourceEpoch: "epoch-b" }),
    ]),
  );

  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((segment) => segment.samples[0].altitudeReference),
    ["barometric", "geometric", "barometric"],
  );
  assert.ok(
    segments.every((segment) =>
      segment.samples.slice(1).every(
        (sample, index) =>
          Math.abs(sample.lng - segment.samples[index].lng) <= 180,
      ),
    ),
  );
});

test("partial retention remains explicit and renders disconnected paths", () => {
  const payload = parseRelayTrackResponse({
    track: track([
      fix(0, 10),
      fix(5, 10.01),
      fix(40, 20),
      fix(45, 20.01),
    ]),
    meta: {
      sourceStatus: "live",
      attribution: { provider: "synthetic" },
      retention: {
        retentionStart: "2026-08-30T00:00:00.000Z",
        retentionEnd: "2026-08-30T00:01:00.000Z",
        retentionComplete: false,
      },
    },
  });
  assert.ok(payload?.track);
  assert.equal(relayHistoryOutcome(payload!.meta), "partial-history");

  const historySegments = relayHistoryTrackToSegments(payload!.track!);
  const envelope: TrailEnvelope = {
    icao24: "abc123",
    provider: "aeris-relay",
    outcome: "partial-history",
    selectionGeneration: 1,
    liveRevision: 0,
    historyRevision: 1,
    lastSeenAt: 0,
    liveTail: [],
    historySegments,
    entry: null,
  };
  const entry = buildTrailGeometry(envelope);
  assert.equal(entry.fullHistory, false);
  assert.equal(entry.renderSegments?.length, 2);
  const display = buildTrailDisplayGeometry(entry, 80);
  assert.equal(display.segments?.length, 2);
});

test("explicit discontinuity never creates a bridge", () => {
  const history = track([
    fix(0, 10),
    fix(5, 10.01),
    fix(10, 10.02, { discontinuity: true }),
    fix(15, 10.03),
  ]);
  const segments = relayHistoryTrackToSegments(history);
  assert.equal(segments.length, 2);
  assert.deepEqual(
    relayHistoryTrackToFlightTrack(history)?.path.map((point) => point.time),
    [Date.parse(fix(10, 10.02).fixTime), Date.parse(fix(15, 10.03).fixTime)],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeHistoryAndLive,
  sampleFromFlight,
  splitIntoParts,
} from "@/lib/trails/geometry/trail-parts";

import {
  parseRelayTrackResponse,
  relayHistoryOutcome,
  relayHistoryTrackToSamples,
} from "./history";
import {
  relayObservationToFlightState,
  type RelayHistoryTrack,
  type RelayObservation,
} from "./protocol";

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

/** The drawable parts of a relay track: runs of two or more samples. */
function parts(history: RelayHistoryTrack) {
  return splitIntoParts(relayHistoryTrackToSamples(history)).filter(
    (part) => part.length >= 2,
  );
}

test("relay history breaks on datum, source, gap, and antimeridian boundaries", () => {
  const drawn = parts(
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

  assert.equal(drawn.length, 3);
  assert.deepEqual(
    drawn.map((part) => part[0].altitudeReference),
    ["barometric", "geometric", "barometric"],
  );
  assert.ok(
    drawn.every((part) =>
      part
        .slice(1)
        .every(
          (sample, index) => Math.abs(sample.lng - part[index].lng) <= 180,
        ),
    ),
  );
});

test("partial retention remains explicit and keeps disconnected parts apart", () => {
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
  assert.equal(parts(payload!.track!).length, 2);
});

test("explicit discontinuity never creates a bridge", () => {
  const drawn = parts(
    track([
      fix(0, 10),
      fix(5, 10.01),
      fix(10, 10.02, { discontinuity: true }),
      fix(15, 10.03),
    ]),
  );

  assert.equal(drawn.length, 2);
  assert.deepEqual(
    drawn[1].map((sample) => sample.t),
    [Date.parse(fix(10, 10.02).fixTime), Date.parse(fix(15, 10.03).fixTime)],
  );
});

test("relay history continues into the live relay trail of the same track", () => {
  const history = relayHistoryTrackToSamples(
    track([fix(0, 10), fix(5, 10.01)]),
  );
  const live = [fix(10, 10.02), fix(15, 10.03)].map(
    (observation) =>
      sampleFromFlight(relayObservationToFlightState(observation))!,
  );

  assert.equal(splitIntoParts(mergeHistoryAndLive(history, live)).length, 1);
});

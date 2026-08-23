import assert from "node:assert/strict";
import test from "node:test";

import {
  createFlightProvenance,
  normalizeFlightTimestamp,
} from "./flight-provenance";
import { parseStates } from "./opensky-parsing";

test("normalizes second and millisecond flight timestamps", () => {
  assert.equal(normalizeFlightTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(
    normalizeFlightTimestamp(1_700_000_000_250),
    1_700_000_000_250,
  );
  assert.equal(normalizeFlightTimestamp(Number.NaN), null);
});

test("preserves provider identity and position age", () => {
  assert.deepEqual(
    createFlightProvenance({
      positionProvider: "adsb.lol",
      responseTime: 1_700_000_010_000,
      observationTime: 1_700_000_008_000,
    }),
    {
      responseTime: 1_700_000_010_000,
      observationTime: 1_700_000_008_000,
      positionAgeSeconds: 2,
      contributingSources: ["adsb.lol"],
      positionProvider: "adsb.lol",
    },
  );
});

test("uses OpenSky response and position timestamps", () => {
  const flight = parseStates(
    {
      time: 1_700_000_010,
      states: [
        [
          "abc123",
          "TST123",
          "United States",
          1_700_000_008,
          1_700_000_009,
          -122.4,
          37.7,
          10_000,
          false,
          220,
          90,
          0,
          null,
          10_100,
          "1200",
          false,
          0,
          3,
        ],
      ],
    },
    { includeGround: true, requireBaroAltitude: false },
  )[0];

  assert.equal(flight.provenance.responseTime, 1_700_000_010_000);
  assert.equal(flight.provenance.observationTime, 1_700_000_008_000);
  assert.equal(flight.provenance.positionAgeSeconds, 2);
  assert.equal(flight.provenance.positionProvider, "opensky");
});

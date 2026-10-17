import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState, FlightTrack } from "@/lib/opensky";

import { createTrailStore } from "./trail-store";

const T0 = 1_700_000_000_000;

function flight(
  observationTime: number,
  overrides: Partial<FlightState> = {},
): FlightState {
  return {
    icao24: "abc123",
    callsign: "TST123",
    registrationCountry: null,
    longitude: -122 + (observationTime - T0) / 400_000,
    latitude: 37.5,
    baroAltitude: 3_000,
    onGround: false,
    velocity: 220,
    trueTrack: 90,
    verticalRate: 0,
    geoAltitude: 3_050,
    squawk: null,
    spiFlag: false,
    positionSource: "adsb",
    category: 3,
    provenance: {
      responseTime: observationTime + 500,
      observationTime,
      positionAgeSeconds: 0.5,
      contributingSources: ["adsb.lol"],
      positionProvider: "adsb.lol",
    },
    ...overrides,
  };
}

type Store = ReturnType<typeof createTrailStore>;

function trailOf(store: Store, icao24: string) {
  return store.getSnapshot().trails.find((trail) => trail.icao24 === icao24);
}

function samples(store: Store, icao24 = "abc123") {
  return trailOf(store, icao24)?.parts.flat() ?? [];
}

test("the first poll records only the observed position, with no invented history", () => {
  const store = createTrailStore();
  store.ingestLiveFlights([flight(T0)], { now: T0 });

  assert.deepEqual(store.getSnapshot().trails[0].parts, [
    [{ t: T0, lng: -122, lat: 37.5, alt: 3_000, onGround: false }],
  ]);
});

test("samples carry the provider's observation time and repeats are not appended", () => {
  const store = createTrailStore();
  // The local clock runs ten minutes ahead of the provider's.
  const localNow = T0 + 600_000;
  store.ingestLiveFlights([flight(T0)], { now: localNow });
  store.ingestLiveFlights([flight(T0)], { now: localNow + 5_000 });
  store.ingestLiveFlights([flight(T0 + 5_000)], { now: localNow + 10_000 });

  assert.deepEqual(
    samples(store).map((sample) => sample.t),
    [T0, T0 + 5_000],
  );
});

test("an empty poll keeps the trails, which survive a short dropout", () => {
  const store = createTrailStore();
  store.ingestLiveFlights([flight(T0)], { now: T0 });
  store.ingestLiveFlights([flight(T0 + 5_000)], { now: T0 + 5_000 });

  store.ingestLiveFlights([], { now: T0 + 10_000 });
  store.ingestLiveFlights([flight(T0, { icao24: "def456" })], {
    now: T0 + 15_000,
  });
  store.ingestLiveFlights([flight(T0 + 20_000)], { now: T0 + 20_000 });

  assert.equal(samples(store).length, 3);
});

test("an aircraft missing for over a minute loses its trail unless it is selected", () => {
  const store = createTrailStore();
  store.ingestLiveFlights(
    [flight(T0), flight(T0, { icao24: "def456" })],
    { now: T0 },
  );
  store.selectAircraft("DEF456");

  store.ingestLiveFlights([flight(T0, { icao24: "aaa111" })], {
    now: T0 + 61_000,
  });

  assert.deepEqual(
    store.getSnapshot().trails.map((trail) => trail.icao24).sort(),
    ["aaa111", "def456"],
  );
});

test("MLAT positions are eased like the map eases them", () => {
  const store = createTrailStore();
  store.ingestLiveFlights(
    [flight(T0, { positionSource: "mlat", longitude: -122 })],
    { now: T0 },
  );
  store.ingestLiveFlights(
    [flight(T0 + 5_000, { positionSource: "mlat", longitude: -121.99 })],
    { now: T0 + 5_000 },
  );

  assert.ok(Math.abs(samples(store)[1].lng - (-122 + 0.01 * 0.65)) < 1e-9);
});

test("history joins the live trail by time and is cleared when the selection moves", () => {
  const store = createTrailStore();
  store.ingestLiveFlights([flight(T0)], { now: T0 });
  store.ingestLiveFlights([flight(T0 + 5_000)], { now: T0 + 5_000 });
  const generation = store.selectAircraft("abc123");

  const track: FlightTrack = {
    icao24: "abc123",
    startTime: T0 / 1000 - 60,
    endTime: T0 / 1000 + 5,
    callsign: null,
    // Overlaps the live samples, as a trace that is newer than the feed does.
    path: [-60, -30, 0, 5].map((seconds) => ({
      time: T0 / 1000 + seconds,
      latitude: 37.5,
      longitude: -122 + (seconds * 1000) / 400_000,
      baroAltitude: 2_800,
      trueTrack: 90,
      onGround: false,
    })),
  };

  store.resolveHistory({
    icao24: "abc123",
    selectionGeneration: generation - 1,
    provider: "airplanes-live",
    outcome: "full-history",
    track,
  });
  assert.equal(samples(store).length, 2, "a stale response is ignored");

  store.resolveHistory({
    icao24: "abc123",
    selectionGeneration: generation,
    provider: "airplanes-live",
    outcome: "full-history",
    track,
  });
  assert.deepEqual(
    samples(store).map((sample) => sample.t),
    [T0 - 60_000, T0 - 30_000, T0, T0 + 5_000],
  );
  assert.equal(store.getSnapshot().trails[0].hasHistory, true);

  store.selectAircraft(null);
  assert.equal(samples(store).length, 2);
  assert.equal(store.getSnapshot().trails[0].hasHistory, false);
});

test("a track keeps its revision until its samples change", () => {
  const store = createTrailStore();
  store.ingestLiveFlights(
    [flight(T0), flight(T0, { icao24: "def456" })],
    { now: T0 },
  );
  const before = trailOf(store, "def456");

  store.ingestLiveFlights(
    [flight(T0 + 5_000), flight(T0, { icao24: "def456" })],
    { now: T0 + 5_000 },
  );
  const after = trailOf(store, "def456");

  assert.equal(after, before);
});

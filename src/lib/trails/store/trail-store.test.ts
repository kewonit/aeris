import assert from "node:assert/strict";
import test from "node:test";

import { createTrailStore } from "./trail-store";

function withMockedNow(run: (advanceMs: (ms: number) => void) => void) {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    run((ms: number) => {
      now += ms;
    });
  } finally {
    Date.now = originalNow;
  }
}

function makeLiveFlight(overrides: {
  icao24: string;
  longitude: number;
  latitude: number;
  baroAltitude?: number | null;
  trueTrack?: number | null;
  velocity?: number | null;
  onGround?: boolean;
}) {
  return {
    icao24: overrides.icao24,
    longitude: overrides.longitude,
    latitude: overrides.latitude,
    baroAltitude: overrides.baroAltitude ?? 1_200,
    trueTrack: overrides.trueTrack ?? 90,
    velocity: overrides.velocity ?? 95,
    onGround: overrides.onGround ?? false,
  } as never;
}

test("empty polls preserve the last trail result when trails already exist", () => {
  const store = createTrailStore();

  store.ingestLiveFlights([
    {
      icao24: "3c66b0",
      longitude: 8.55,
      latitude: 50.04,
      baroAltitude: 11_000,
      trueTrack: 270,
      velocity: 220,
      onGround: false,
    } as never,
    {
      icao24: "3c66b0",
      longitude: 8.56,
      latitude: 50.04,
      baroAltitude: 11_010,
      trueTrack: 270,
      velocity: 220,
      onGround: false,
    } as never,
  ]);

  const first = store.getSnapshot().trails.length;
  store.ingestLiveFlights([]);
  const second = store.getSnapshot().trails.length;

  assert.equal(first, second);
});

test("history resolution is ignored when selection generation is stale", () => {
  const store = createTrailStore();
  const generation = store.selectAircraft("3c66b0");
  store.selectAircraft("3c6444");

  store.resolveHistory({
    icao24: "3c66b0",
    selectionGeneration: generation,
    provider: "adsb-lol",
    outcome: "full-history",
    path: [],
  });

  assert.equal(store.getSnapshot().history.selectedIcao24, "3c6444");
});

test("selected-flight disappearance uses a grace window before degrading", () => {
  const store = createTrailStore();
  store.selectAircraft("3c66b0");

  store.markSelectedMissing(1_000);
  assert.equal(store.getSnapshot().history.outcome, null);

  store.markSelectedMissing(1_000 + 31_000);
  assert.equal(store.getSnapshot().history.outcome, "live-tail-only");
});

test("selected envelope is exposed so map rendering can preserve history and live boundaries", () => {
  const store = createTrailStore();

  store.ingestLiveFlights([
    {
      icao24: "3c66b0",
      longitude: 8.55,
      latitude: 50.04,
      baroAltitude: 11_000,
      trueTrack: 270,
      velocity: 220,
      onGround: false,
    } as never,
    {
      icao24: "3c66b0",
      longitude: 8.56,
      latitude: 50.04,
      baroAltitude: 11_050,
      trueTrack: 270,
      velocity: 220,
      onGround: false,
    } as never,
  ]);

  const selectionGeneration = store.selectAircraft("3c66b0");
  store.resolveHistory({
    icao24: "3c66b0",
    selectionGeneration,
    provider: "adsb-fi",
    outcome: "full-history",
    track: {
      icao24: "3c66b0",
      startTime: 1,
      endTime: 2,
      callsign: "DLH7YA",
      path: [
        {
          time: 1,
          latitude: 50.0,
          longitude: 8.4,
          baroAltitude: 10_800,
          trueTrack: 270,
          onGround: false,
        },
        {
          time: 2,
          latitude: 50.02,
          longitude: 8.5,
          baroAltitude: 10_900,
          trueTrack: 270,
          onGround: false,
        },
      ],
    },
  });

  const snapshot = store.getSnapshot();

  assert.equal(snapshot.selectedEnvelope?.icao24, "3c66b0");
  assert.equal(snapshot.selectedEnvelope?.historySegments.length, 1);
  assert.ok((snapshot.selectedEnvelope?.liveTail.length ?? 0) >= 2);
});

test("ingestLiveFlights keeps selected tracking stable when live ICAO24 casing differs", () => {
  const store = createTrailStore();

  store.selectAircraft("abc123");
  withMockedNow(() => {
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "ABC123",
        longitude: 72.934,
        latitude: 19.142,
      }),
    ]);
  });

  const snapshot = store.getSnapshot();

  assert.equal(snapshot.history.selectedIcao24, "abc123");
  assert.equal(snapshot.selectedEnvelope?.icao24, "abc123");
  assert.equal(snapshot.history.missingSinceMs, null);
  assert.ok((snapshot.selectedEnvelope?.liveTail.length ?? 0) >= 1);
});

test("ingestLiveFlights keeps a longer live step when elapsed time and speed make it plausible", () => {
  const store = createTrailStore();

  withMockedNow((advanceMs) => {
    store.ingestLiveFlights([
      {
        icao24: "3c66b0",
        longitude: 72.8,
        latitude: 19.0,
        baroAltitude: 1_000,
        trueTrack: 90,
        velocity: 240,
        onGround: false,
      } as never,
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      {
        icao24: "3c66b0",
        longitude: 72.818,
        latitude: 19.0,
        baroAltitude: 1_010,
        trueTrack: 88,
        velocity: 240,
        onGround: false,
      } as never,
    ]);

    advanceMs(18_000);
    store.ingestLiveFlights([
      {
        icao24: "3c66b0",
        longitude: 72.858,
        latitude: 19.01,
        baroAltitude: 1_020,
        trueTrack: 74,
        velocity: 240,
        onGround: false,
      } as never,
    ]);
  });

  const trail = store.getSnapshot().trails[0];

  assert.deepEqual(trail?.path.slice(-3), [
    [72.8, 19.0],
    [72.818, 19.0],
    [72.858, 19.01],
  ]);
});

test("ingestLiveFlights still resets on a true teleport even after a valid live leg", () => {
  const store = createTrailStore();

  withMockedNow((advanceMs) => {
    store.ingestLiveFlights([
      {
        icao24: "3c66b0",
        longitude: 72.8,
        latitude: 19.0,
        baroAltitude: 1_000,
        trueTrack: 90,
        velocity: 240,
        onGround: false,
      } as never,
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      {
        icao24: "3c66b0",
        longitude: 72.818,
        latitude: 19.0,
        baroAltitude: 1_010,
        trueTrack: 88,
        velocity: 240,
        onGround: false,
      } as never,
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      {
        icao24: "3c66b0",
        longitude: 73.6,
        latitude: 19.8,
        baroAltitude: 1_050,
        trueTrack: 70,
        velocity: 240,
        onGround: false,
      } as never,
    ]);
  });

  assert.equal(store.getSnapshot().trails.length, 0);
});

test("ingestLiveFlights drops bootstrap points once real low-phase samples establish the live leg", () => {
  const store = createTrailStore();

  withMockedNow((advanceMs) => {
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "depboot",
        longitude: 72.9898,
        latitude: 19.0885,
        baroAltitude: 750,
        trueTrack: 78,
        velocity: 82,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "depboot",
        longitude: 72.9968,
        latitude: 19.0914,
        baroAltitude: 900,
        trueTrack: 58,
        velocity: 84,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "depboot",
        longitude: 73.0024,
        latitude: 19.0968,
        baroAltitude: 1_050,
        trueTrack: 34,
        velocity: 88,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "depboot",
        longitude: 73.0054,
        latitude: 19.1038,
        baroAltitude: 1_220,
        trueTrack: 18,
        velocity: 92,
      }),
    ]);
  });

  const trail = store
    .getSnapshot()
    .trails.find((entry) => entry.icao24 === "depboot");

  assert.deepEqual(trail?.path, [
    [72.9898, 19.0885],
    [72.9968, 19.0914],
    [73.0024, 19.0968],
    [73.0054, 19.1038],
  ]);
});

test("ingestLiveFlights preserves a valid low-phase airport turn across consecutive real samples", () => {
  const store = createTrailStore();

  withMockedNow((advanceMs) => {
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "appro01",
        longitude: 72.934,
        latitude: 19.142,
        baroAltitude: 1_600,
        trueTrack: 150,
        velocity: 96,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "appro01",
        longitude: 72.939,
        latitude: 19.135,
        baroAltitude: 1_420,
        trueTrack: 168,
        velocity: 94,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "appro01",
        longitude: 72.946,
        latitude: 19.13,
        baroAltitude: 1_240,
        trueTrack: 198,
        velocity: 92,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "appro01",
        longitude: 72.954,
        latitude: 19.128,
        baroAltitude: 1_080,
        trueTrack: 236,
        velocity: 89,
      }),
    ]);
  });

  const trail = store
    .getSnapshot()
    .trails.find((entry) => entry.icao24 === "appro01");

  assert.deepEqual(trail?.path.slice(-4), [
    [72.934, 19.142],
    [72.939, 19.135],
    [72.946, 19.13],
    [72.954, 19.128],
  ]);
});

test("ingestLiveFlights keeps the first smooth turn sample that descends into low phase", () => {
  const store = createTrailStore();

  withMockedNow((advanceMs) => {
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "appro-transition01",
        longitude: 72.934,
        latitude: 19.142,
        baroAltitude: 2_200,
        trueTrack: 150,
        velocity: 96,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "appro-transition01",
        longitude: 72.946,
        latitude: 19.13,
        baroAltitude: 2_050,
        trueTrack: 198,
        velocity: 92,
      }),
    ]);

    advanceMs(10_000);
    store.ingestLiveFlights([
      makeLiveFlight({
        icao24: "appro-transition01",
        longitude: 72.954,
        latitude: 19.128,
        baroAltitude: 1_900,
        trueTrack: 236,
        velocity: 89,
      }),
    ]);
  });

  const trail = store
    .getSnapshot()
    .trails.find((entry) => entry.icao24 === "appro-transition01");

  assert.deepEqual(trail?.path.slice(-3), [
    [72.934, 19.142],
    [72.946, 19.13],
    [72.954, 19.128],
  ]);
});

test("ingestLiveFlights keeps sparse holding-pattern samples even when the chord heading diverges from the instantaneous track", () => {
  const store = createTrailStore();

  withMockedNow((advanceMs) => {
    store.ingestLiveFlights([
      {
        icao24: "hold01",
        longitude: 72.98,
        latitude: 19.1,
        baroAltitude: 5_500,
        trueTrack: 0,
        velocity: 115,
        onGround: false,
      } as never,
    ]);

    advanceMs(60_000);
    store.ingestLiveFlights([
      {
        icao24: "hold01",
        longitude: 72.94,
        latitude: 19.1,
        baroAltitude: 5_550,
        trueTrack: 180,
        velocity: 115,
        onGround: false,
      } as never,
    ]);

    advanceMs(60_000);
    store.ingestLiveFlights([
      {
        icao24: "hold01",
        longitude: 72.91,
        latitude: 19.065,
        baroAltitude: 5_620,
        trueTrack: 225,
        velocity: 115,
        onGround: false,
      } as never,
    ]);
  });

  const trail = store
    .getSnapshot()
    .trails.find((entry) => entry.icao24 === "hold01");

  assert.deepEqual(trail?.path.slice(-3), [
    [72.98, 19.1],
    [72.94, 19.1],
    [72.91, 19.065],
  ]);
});

test("ingestLiveFlights retains more than the old 120-point ceiling for recent live motion", () => {
  const store = createTrailStore();
  const centerLng = 72.95;
  const centerLat = 19.08;
  const radiusLng = 0.018;
  const radiusLat = 0.012;

  withMockedNow((advanceMs) => {
    for (let index = 0; index < 180; index += 1) {
      const angle = (index / 180) * Math.PI * 6;
      const trueTrack =
        ((Math.atan2(
          -Math.sin(angle) * radiusLng,
          Math.cos(angle) * radiusLat,
        ) *
          180) /
          Math.PI +
          360) %
        360;
      store.ingestLiveFlights([
        {
          icao24: "loop01",
          longitude: centerLng + Math.cos(angle) * radiusLng,
          latitude: centerLat + Math.sin(angle) * radiusLat,
          baroAltitude: 4_800 + index,
          trueTrack,
          velocity: 95,
          onGround: false,
        } as never,
      ]);

      advanceMs(2_000);
    }
  });

  const trail = store
    .getSnapshot()
    .trails.find((entry) => entry.icao24 === "loop01");

  assert.ok((trail?.path.length ?? 0) > 120);
});

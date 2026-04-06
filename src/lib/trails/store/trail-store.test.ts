import assert from "node:assert/strict";
import test from "node:test";

import { createTrailStore } from "./trail-store";

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

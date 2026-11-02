import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";
import {
  INITIAL_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from "./use-selection";

const seed = { icao24: "abc123" } as FlightState;

function run(...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, INITIAL_SELECTION);
}

test("selecting an aircraft keeps its seed and lower-cases its address", () => {
  const state = run({ type: "selectAircraft", icao24: "ABC123", seed });
  assert.deepEqual(state.selection, { kind: "aircraft", icao24: "abc123" });
  assert.equal(state.seed, seed);
});

test("closing the card keeps following; picking another aircraft stops it", () => {
  const following = run({ type: "follow", icao24: "abc123" });
  assert.equal(following.follow, "abc123");

  const closed = selectionReducer(following, { type: "clear" });
  assert.deepEqual(closed.selection, { kind: "none" });
  assert.equal(closed.follow, "abc123");

  const reopened = selectionReducer(closed, {
    type: "selectAircraft",
    icao24: "abc123",
  });
  assert.equal(reopened.follow, "abc123");

  const other = selectionReducer(reopened, {
    type: "selectAircraft",
    icao24: "def456",
  });
  assert.equal(other.follow, null);
});

test("an airport replaces any aircraft and stops following", () => {
  const state = run(
    { type: "follow", icao24: "abc123" },
    { type: "selectAirport", iata: "BOM" },
  );
  assert.deepEqual(state.selection, { kind: "airport", iata: "BOM" });
  assert.equal(state.follow, null);
});

test("first person and follow never run together", () => {
  const fpv = run(
    { type: "follow", icao24: "abc123" },
    { type: "enterFpv", icao24: "abc123" },
  );
  assert.equal(fpv.fpv, "abc123");
  assert.equal(fpv.follow, null);

  const following = selectionReducer(fpv, { type: "follow", icao24: "abc123" });
  assert.equal(following.fpv, null);
  assert.equal(following.follow, "abc123");
});

test("leaving first person keeps the card only when the pilot chose to leave", () => {
  const entered = run({ type: "enterFpv", icao24: "abc123" });
  assert.deepEqual(selectionReducer(entered, { type: "exitFpv", how: "exited" }).selection, {
    kind: "aircraft",
    icao24: "abc123",
  });
  assert.deepEqual(selectionReducer(entered, { type: "exitFpv", how: "landed" }).selection, {
    kind: "none",
  });
  assert.deepEqual(selectionReducer(entered, { type: "exitFpv", how: "lost" }).selection, {
    kind: "none",
  });
});

test("actions that change nothing return the same state", () => {
  assert.equal(selectionReducer(INITIAL_SELECTION, { type: "clear" }), INITIAL_SELECTION);
  assert.equal(selectionReducer(INITIAL_SELECTION, { type: "unfollow" }), INITIAL_SELECTION);
  assert.equal(selectionReducer(INITIAL_SELECTION, { type: "dropSeed" }), INITIAL_SELECTION);
  assert.equal(
    selectionReducer(INITIAL_SELECTION, { type: "exitFpv", how: "exited" }),
    INITIAL_SELECTION,
  );
});

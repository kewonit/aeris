import assert from "node:assert/strict";
import test from "node:test";

import { parseReadsbTrace } from "./parse-readsb-trace";

test("parseReadsbTrace skips stale points and trims to the last flagged leg", () => {
  const track = parseReadsbTrace("3c66b0", {
    timestamp: 1_000,
    trace: [
      [0, 40.0, -70.0, "ground", null, 0, 0],
      [60, 40.2, -69.8, 12_000, 420, 90, 0],
      [500, 50.0, 8.0, "ground", null, 0, 2],
      [520, 50.1, 8.1, 1_000, 180, 15, 0],
      [530, 50.15, 8.2, 1_100, 185, 18, 1],
      [540, 50.2, 8.3, 1_200, 190, 20, 0],
    ],
  });

  assert.ok(track);
  assert.equal(track?.path.length, 3);
  assert.equal(track?.path[0]?.onGround, true);
  assert.equal(track?.path[0]?.longitude, 8.0);
  assert.equal(track?.path[1]?.longitude, 8.1);
  assert.equal(track?.path[2]?.longitude, 8.3);
});

test("parseReadsbTrace returns null when fewer than two valid waypoints remain", () => {
  const track = parseReadsbTrace("3c66b0", {
    timestamp: 1_000,
    trace: [[0, 50.0, 8.0, "ground", null, 0, 1]],
  });

  assert.equal(track, null);
});

test("parseReadsbTrace keeps only the last departure plus a short runway roll when no new-leg flag exists", () => {
  const track = parseReadsbTrace("3c66b0", {
    timestamp: 10_000,
    trace: [
      [0, 40.0, -70.0, "ground", null, 0, 0],
      [50, 40.1, -69.8, 8_000, 210, 80, 0],
      [600, 51.47, -0.45, "ground", null, 0, 0],
      [610, 51.471, -0.44, "ground", null, 0, 0],
      [620, 51.472, -0.43, 200, 80, 90, 0],
      [660, 51.49, -0.2, 5_000, 220, 95, 0],
    ],
  });

  assert.ok(track);
  assert.deepEqual(
    track?.path.map((waypoint) => [waypoint.longitude, waypoint.onGround]),
    [
      [-0.44, true],
      [-0.43, false],
      [-0.2, false],
    ],
  );
  assert.equal(
    track?.path.some((waypoint) => waypoint.longitude === -70.0),
    false,
  );
});

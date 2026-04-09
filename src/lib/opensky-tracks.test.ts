import assert from "node:assert/strict";
import test from "node:test";

import { parseFlightTrack } from "./opensky-tracks";

test("parseFlightTrack trims OpenSky responses to the latest plausible departure leg", () => {
  const track = parseFlightTrack("3c66b0", {
    startTime: 1_000,
    endTime: 1_660,
    path: [
      [1_000, 40.0, -70.0, 0, 0, true],
      [1_050, 40.1, -69.8, 8_000, 80, false],
      [1_600, 51.47, -0.45, 0, 0, true],
      [1_610, 51.471, -0.44, 0, 0, true],
      [1_620, 51.472, -0.43, 200, 90, false],
      [1_660, 51.49, -0.2, 5_000, 95, false],
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
  assert.equal(track?.startTime, 1_610);
  assert.equal(track?.endTime, 1_660);
});

test("parseFlightTrack drops implausible older jumps from OpenSky responses", () => {
  const track = parseFlightTrack("800001", {
    startTime: 20_000,
    endTime: 20_120,
    path: [
      [20_000, 19.08, 72.88, 8_000, 88, false],
      [20_040, 19.09, 72.9, 8_100, 87, false],
      [20_080, 20.8, 75.7, 8_200, 85, false],
      [20_120, 20.82, 75.72, 8_300, 84, false],
    ],
  });

  assert.ok(track);
  assert.deepEqual(
    track?.path.map((waypoint) => waypoint.longitude),
    [75.7, 75.72],
  );
  assert.equal(track?.startTime, 20_080);
  assert.equal(track?.endTime, 20_120);
});

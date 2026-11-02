import assert from "node:assert/strict";
import test from "node:test";

import { routeAheadPath } from "./route-ahead";

const LHR = { lng: -0.4614, lat: 51.47 };
const JFK = { lng: -73.7781, lat: 40.6413 };

test("the way ahead runs from the aircraft to the runway", () => {
  const path = routeAheadPath({ ...LHR, altitudeMeters: 11_000 }, JFK);
  const [first, last] = [path[0], path[path.length - 1]];
  assert.ok(path.length > 10);
  assert.deepEqual(first.slice(0, 2), [LHR.lng, LHR.lat]);
  assert.ok(Math.abs(last[0] - JFK.lng) < 1e-6 && Math.abs(last[1] - JFK.lat) < 1e-6);
  assert.equal(last[2], 0);
});

test("it holds its height, then comes down at about three degrees", () => {
  const path = routeAheadPath({ ...LHR, altitudeMeters: 11_000 }, JFK);
  assert.equal(path[0][2], 11_000);
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i][2] <= path[i - 1][2] + 1e-6, "never climbs");
  }
});

test("a great circle bends toward the pole", () => {
  const path = routeAheadPath({ ...LHR, altitudeMeters: 11_000 }, JFK);
  const north = Math.max(...path.map((point) => point[1]));
  assert.ok(north > LHR.lat + 1);
});

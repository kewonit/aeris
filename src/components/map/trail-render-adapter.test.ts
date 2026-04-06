import assert from "node:assert/strict";
import test from "node:test";

import { toPathLayerPoints } from "./trail-render-adapter";

test("render adapter uses the canonical trail entry without re-running legacy path stitching", () => {
  const points = toPathLayerPoints({
    icao24: "3c66b0",
    path: [
      [8.0, 50.0],
      [8.02, 50.0],
    ],
    altitudes: [11_000, 11_050],
    timestamps: [1, 2],
    baroAltitude: 11_050,
    fullHistory: true,
    provider: "adsb-lol",
    outcome: "full-history",
    revision: 7,
  });

  assert.equal(points.length, 2);
  assert.deepEqual(points[0], [8.0, 50.0, 11_000]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrailBodyGradientColors,
  buildTrailRenderSegments,
  trimTrailBodyForConnector,
} from "./trail-render-segments";

test("buildTrailRenderSegments emits drawable body segments for an active trail", () => {
  const result = buildTrailRenderSegments({
    icao24: "abc123",
    points: [
      [8.0, 50.0, 1000],
      [8.01, 50.0, 1010],
      [8.02, 50.0, 1020],
    ],
    kind: "body",
    altColors: true,
    defaultColor: [255, 255, 255, 255],
  });

  assert.equal(result.length, 2);
  assert.ok(result.every((segment) => segment.path.length === 2));
  assert.ok(result.every((segment) => segment.color[3] >= 55));
});

test("buildTrailRenderSegments emits drawable segments for selected full-history trails", () => {
  const result = buildTrailRenderSegments({
    icao24: "hist01",
    points: [
      [8.0, 50.0, 900],
      [8.01, 50.01, 1100],
      [8.02, 50.02, 1300],
      [8.03, 50.03, 1400],
    ],
    kind: "body",
    altColors: true,
    defaultColor: [255, 255, 255, 255],
  });

  assert.ok(result.length >= 3);
  assert.ok(result.every((segment) => segment.path.length === 2));
});

test("trimTrailBodyForConnector clips only the terminal body point behind the aircraft gap", () => {
  const result = trimTrailBodyForConnector(
    [
      [8.0, 50.0, 1000],
      [8.01, 50.0, 1010],
      [8.02, 50.0, 1020],
    ],
    120,
  );

  assert.equal(result.length, 3);
  assert.equal(result[0][0], 8.0);
  assert.equal(result[1][0], 8.01);
  assert.ok(result[2][0] < 8.02);
  assert.ok(result[2][0] > 8.01);
});

test("buildTrailRenderSegments blends adjacent altitude colors for smoother transitions", () => {
  const points: [number, number, number][] = [
    [8.0, 50.0, 0],
    [8.01, 50.0, 6500],
    [8.02, 50.0, 13000],
  ];
  const pointColors = buildTrailBodyGradientColors(
    points,
    true,
    [255, 255, 255, 255],
  );
  const result = buildTrailRenderSegments({
    icao24: "abc123",
    points,
    kind: "body",
    altColors: true,
    defaultColor: [255, 255, 255, 255],
  });

  assert.notDeepStrictEqual(result[0].color, pointColors[1]);
  assert.ok(
    result[0].color[0] !== pointColors[0][0] ||
      result[0].color[1] !== pointColors[0][1] ||
      result[0].color[2] !== pointColors[0][2],
  );
});

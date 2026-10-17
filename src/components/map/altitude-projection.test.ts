import assert from "node:assert/strict";
import test from "node:test";

import { WebMercatorViewport } from "@deck.gl/core";

import {
  aircraftElevationMeters,
  cameraHeightMeters,
  projectDisplayedAltitudeMeters,
} from "./altitude-projection";

test("presentation altitude mode is monotonic and much lighter than the old x5 projection", () => {
  const low = projectDisplayedAltitudeMeters(500, "presentation");
  const mid = projectDisplayedAltitudeMeters(3_000, "presentation");
  const high = projectDisplayedAltitudeMeters(11_000, "presentation");

  assert.ok(low > 500);
  assert.ok(mid > low);
  assert.ok(high > mid);
  assert.ok(high < 11_000 * 5);
});

test("realistic altitude mode stays close to raw altitude", () => {
  assert.equal(projectDisplayedAltitudeMeters(2_000, "realistic"), 2_000);
});

test("presentation mode stays visually separated above realistic mode", () => {
  const presentation = projectDisplayedAltitudeMeters(2_000, "presentation");
  const realistic = projectDisplayedAltitudeMeters(2_000, "realistic");

  assert.ok(presentation > realistic);
});

test("presentation mode gives low and mid altitudes extra lift for a taller map view", () => {
  const low = projectDisplayedAltitudeMeters(2_000, "presentation");
  const mid = projectDisplayedAltitudeMeters(8_000, "presentation");

  assert.ok(low >= 2_900);
  assert.ok(mid >= 10_500);
});

test("drawn heights come from altitude alone, as at the default view", () => {
  assert.equal(aircraftElevationMeters(11_000, "presentation"), 50_400);
  assert.equal(aircraftElevationMeters(2_000, "realistic"), 2_000);
  assert.equal(aircraftElevationMeters(null, "presentation"), 0);
});

test("the camera height matches deck's camera", () => {
  for (const [zoom, pitch, height] of [
    [9.2, 49, 900],
    [11, 50, 600],
    [13, 0, 900],
  ]) {
    const viewport = new WebMercatorViewport({
      width: 800,
      height,
      longitude: -122.4,
      latitude: 37.6,
      zoom,
      pitch,
    });
    const expected =
      viewport.cameraPosition[2] / viewport.distanceScales.unitsPerMeter[2];
    const actual = cameraHeightMeters(zoom, 37.6, height, pitch);
    assert.ok(Math.abs(actual / expected - 1) < 0.01);
  }
});

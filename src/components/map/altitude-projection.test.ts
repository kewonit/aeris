import assert from "node:assert/strict";
import test from "node:test";

import { WebMercatorViewport } from "@deck.gl/core";

import {
  GLOBE_FADE_ZOOM_CEIL,
  TRAIL_BELOW_AIRCRAFT_METERS,
} from "./flight-layer-constants";
import {
  cameraHeightMeters,
  elevationUnderCeiling,
  getZoomAdjustedElevationScale,
  heightCeilingMeters,
  projectDisplayedAltitudeMeters,
  projectTrailElevationMeters,
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
  const projected = projectDisplayedAltitudeMeters(2_000, "realistic");
  const trail = projectTrailElevationMeters(2_000, "realistic");

  assert.equal(projected, 2_000);
  assert.equal(projected - trail, TRAIL_BELOW_AIRCRAFT_METERS);
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

test("trail elevation stays below the aircraft projection by the visual offset", () => {
  const projected = projectDisplayedAltitudeMeters(2_000, "presentation");
  const trail = projectTrailElevationMeters(2_000, "presentation");

  assert.equal(projected - trail, TRAIL_BELOW_AIRCRAFT_METERS);
});

test("visible flight zooms preserve most of the requested height", () => {
  const scale = getZoomAdjustedElevationScale(
    GLOBE_FADE_ZOOM_CEIL,
    "realistic",
  );
  const realistic = projectDisplayedAltitudeMeters(2_000, "realistic") * scale;
  const presentation =
    projectDisplayedAltitudeMeters(2_000, "presentation") *
    getZoomAdjustedElevationScale(GLOBE_FADE_ZOOM_CEIL, "presentation");

  assert.ok(scale >= 0.88);
  assert.ok(realistic >= 1_760);
  assert.ok(presentation >= 2_800);
});

test("presentation mode stays slightly taller than realistic by city zoom", () => {
  assert.equal(getZoomAdjustedElevationScale(6.9, "realistic"), 1);
  assert.ok(getZoomAdjustedElevationScale(6.9, "presentation") > 1.04);
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

test("zoomed in, the ceiling stays inside the camera's view", () => {
  for (const zoom of [10.5, 12, 14]) {
    const camera = cameraHeightMeters(zoom, 37.6, 900, 49);
    assert.ok(heightCeilingMeters(zoom, 37.6, 900, 49) < 0.5 * camera);
  }
});

test("at the overview, cruising heights keep their full height", () => {
  const ceiling = heightCeilingMeters(9.2, 37.6, 900, 49);
  const cruise = projectDisplayedAltitudeMeters(11_000, "presentation") * 1.8;

  assert.ok(elevationUnderCeiling(cruise, ceiling) > 0.97 * cruise);
});

test("tilted towards the horizon, the ceiling stops coming down", () => {
  assert.equal(
    heightCeilingMeters(12, 37.6, 900, 80),
    heightCeilingMeters(12, 37.6, 900, 60),
  );
});

test("heights well under the ceiling are drawn as they are", () => {
  assert.equal(elevationUnderCeiling(4_000, 10_000), 4_000);
  assert.equal(elevationUnderCeiling(50_000, Infinity), 50_000);
});

test("higher aircraft ease in under the ceiling and keep their order", () => {
  const ceiling = 10_000;
  let previous = elevationUnderCeiling(4_500, ceiling);
  for (let elevation = 4_600; elevation <= 80_000; elevation += 100) {
    const drawn = elevationUnderCeiling(elevation, ceiling);
    assert.ok(drawn > previous);
    assert.ok(drawn < ceiling);
    previous = drawn;
  }
  // No kink where the easing starts.
  const start = 0.45 * ceiling;
  const slope = elevationUnderCeiling(start + 1, ceiling) - start;
  assert.ok(Math.abs(slope - 1) < 0.001);
});

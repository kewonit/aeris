import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBE_FADE_ZOOM_CEIL,
  TRAIL_BELOW_AIRCRAFT_METERS,
} from "./flight-layer-constants";
import {
  getZoomAdjustedElevationScale,
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

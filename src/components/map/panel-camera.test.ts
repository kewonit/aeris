import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOSED_MAP_PANEL_CAMERA_STATE,
  coordinatesMatch,
  createMapPanelCameraState,
  mapPanelMotionOptions,
  mapPanelPadding,
  panelVisualOffset,
  shouldCenterMapPanel,
} from "./panel-camera";

test("panel camera creates a valid aircraft focus", () => {
  const state = createMapPanelCameraState({
    kind: "flight",
    focusKey: "flight:abc123",
    longitude: -122.4,
    latitude: 37.8,
    altitudeMeters: 9_000,
    leftInsetPx: 444,
  });

  assert.deepEqual(state, {
    open: true,
    kind: "flight",
    focusKey: "flight:abc123",
    coordinates: [-122.4, 37.8],
    altitudeMeters: 9_000,
    leftInsetPx: 444,
  });
  assert.equal(shouldCenterMapPanel(null, state), true);
});

test("panel camera rejects invalid coordinates", () => {
  const state = createMapPanelCameraState({
    kind: "flight",
    focusKey: "flight:abc123",
    longitude: 181,
    latitude: 37.8,
    leftInsetPx: Number.POSITIVE_INFINITY,
  });

  assert.equal(state.coordinates, null);
  assert.equal(state.altitudeMeters, null);
  assert.equal(state.leftInsetPx, 0);
  assert.equal(shouldCenterMapPanel(null, state), false);
});

test("panel camera does not recenter for repeated observations", () => {
  const state = createMapPanelCameraState({
    kind: "flight",
    focusKey: "flight:abc123",
    longitude: -122.3,
    latitude: 37.9,
    leftInsetPx: 444,
  });

  assert.equal(shouldCenterMapPanel("flight:abc123", state), false);
  assert.equal(
    shouldCenterMapPanel("flight:abc123", CLOSED_MAP_PANEL_CAMERA_STATE),
    false,
  );
});

test("panel camera recenters when the panel focus changes", () => {
  const airport = createMapPanelCameraState({
    kind: "airport",
    focusKey: "airport:SFO",
    longitude: -122.379,
    latitude: 37.6213,
    leftInsetPx: 444,
  });

  assert.equal(shouldCenterMapPanel("flight:abc123", airport), true);
});

test("coordinate matching tolerates insignificant source precision", () => {
  assert.equal(
    coordinatesMatch([-122.4, 37.8], [-122.4000001, 37.8000001]),
    true,
  );
  assert.equal(coordinatesMatch([-122.4, 37.8], [-122.41, 37.8]), false);
});

test("panel visual offset reverses and bounds the elevation delta", () => {
  assert.deepEqual(panelVisualOffset({ dx: 40, dy: -60 }, 1_000, 800), [
    -40,
    60,
  ]);
  assert.deepEqual(panelVisualOffset({ dx: 400, dy: -400 }, 1_000, 800), [
    -400,
    400,
  ]);
  assert.deepEqual(panelVisualOffset({ dx: 900, dy: -900 }, 1_000, 800), [
    -680,
    680,
  ]);
});

test("panel padding uses the normalized inset only while open", () => {
  const open = createMapPanelCameraState({
    kind: "airport",
    focusKey: "airport:SFO",
    longitude: -122.379,
    latitude: 37.6213,
    leftInsetPx: -24,
  });

  assert.deepEqual(mapPanelPadding(open), {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  assert.deepEqual(mapPanelPadding(CLOSED_MAP_PANEL_CAMERA_STATE), {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
});

test("panel padding preserves a measured fractional inset", () => {
  const open = createMapPanelCameraState({
    kind: "flight",
    focusKey: "flight:abc123",
    longitude: -122.4,
    latitude: 37.8,
    leftInsetPx: 443.75,
  });

  assert.equal(open.leftInsetPx, 443.75);
  assert.equal(mapPanelPadding(open).left, 443.75);
});

test("panel motion uses the shared cubic easing and respects reduced motion", () => {
  const standard = mapPanelMotionOptions(false);
  const reduced = mapPanelMotionOptions(true);

  assert.equal(standard.duration, 480);
  assert.equal(standard.essential, false);
  assert.equal(standard.easing(0), 0);
  assert.equal(standard.easing(0.5), 0.875);
  assert.equal(standard.easing(1), 1);
  assert.equal(reduced.duration, 0);
  assert.equal(reduced.essential, false);
});

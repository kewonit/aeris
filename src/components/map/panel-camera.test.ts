import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOSED_MAP_PANEL_CAMERA_STATE,
  coordinatesMatch,
  createMapPanelCameraState,
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
  });

  assert.deepEqual(state, {
    open: true,
    kind: "flight",
    focusKey: "flight:abc123",
    coordinates: [-122.4, 37.8],
    altitudeMeters: 9_000,
  });
  assert.equal(shouldCenterMapPanel(null, state), true);
});

test("panel camera rejects invalid coordinates", () => {
  const state = createMapPanelCameraState({
    kind: "flight",
    focusKey: "flight:abc123",
    longitude: 181,
    latitude: 37.8,
  });

  assert.equal(state.coordinates, null);
  assert.equal(state.altitudeMeters, null);
  assert.equal(shouldCenterMapPanel(null, state), false);
});

test("panel camera does not recenter for repeated observations", () => {
  const state = createMapPanelCameraState({
    kind: "flight",
    focusKey: "flight:abc123",
    longitude: -122.3,
    latitude: 37.9,
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

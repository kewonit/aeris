import assert from "node:assert/strict";
import test from "node:test";

import {
  FPV_CAMERA_PITCH,
  FPV_DEFAULT_ALTITUDE_METERS,
  FPV_MIN_CAMERA_ALTITUDE_METERS,
  fpvCameraOptions,
  projectLngLatElevationPixelDelta,
} from "./camera-controller-utils";

test("FPV camera is placed at the aircraft with a forward horizon pitch", () => {
  let received:
    | {
        lng: number;
        lat: number;
        altitude: number;
        bearing: number;
        pitch: number;
        roll: number | undefined;
      }
    | undefined;
  const map = {
    calculateCameraOptionsFromCameraLngLatAltRotation: (
      position: { lng: number; lat: number },
      altitude: number,
      bearing: number,
      pitch: number,
      roll?: number,
    ) => {
      received = {
        lng: position.lng,
        lat: position.lat,
        altitude,
        bearing,
        pitch,
        roll,
      };
      return { center: [4.9, 52.3], zoom: 9, bearing, pitch, roll };
    },
  };

  const options = fpvCameraOptions(
    map as never,
    { lng: 190, lat: 89, alt: -20, track: -10 },
    45,
  );

  assert.deepEqual(received, {
    lng: -170,
    lat: 85.051129,
    altitude: FPV_MIN_CAMERA_ALTITUDE_METERS,
    bearing: 350,
    pitch: FPV_CAMERA_PITCH,
    roll: 0,
  });
  assert.equal(options?.pitch, FPV_CAMERA_PITCH);
  assert.equal(options?.bearing, 350);
});

test("FPV camera uses safe altitude and bearing fallbacks", () => {
  let altitudeReceived = 0;
  let bearingReceived = 0;
  const map = {
    calculateCameraOptionsFromCameraLngLatAltRotation: (
      _position: unknown,
      altitude: number,
      bearing: number,
      pitch: number,
    ) => {
      altitudeReceived = altitude;
      bearingReceived = bearing;
      return { center: [0, 0], zoom: 10, bearing, pitch };
    },
  };

  const options = fpvCameraOptions(
    map as never,
    { lng: 12, lat: 48, alt: Number.NaN, track: null },
    -170,
  );

  assert.ok(options);
  assert.equal(altitudeReceived, FPV_DEFAULT_ALTITUDE_METERS);
  assert.equal(bearingReceived, 190);
});

test("FPV camera rejects unusable positions", () => {
  let calculationCount = 0;
  const map = {
    calculateCameraOptionsFromCameraLngLatAltRotation: () => {
      calculationCount += 1;
      return {};
    },
  };

  assert.equal(
    fpvCameraOptions(
      map as never,
      { lng: Number.NaN, lat: 48, alt: 1_000, track: 90 },
      0,
    ),
    null,
  );
  assert.equal(
    fpvCameraOptions(
      map as never,
      { lng: 12, lat: 91, alt: 1_000, track: 90 },
      0,
    ),
    null,
  );
  assert.equal(calculationCount, 0);
});

test("elevation projection measures from MapLibre's padded visual center", () => {
  const map = {
    transform: {
      centerPoint: { x: 978, y: 400 },
      locationToScreenPoint: () => ({ x: 1_000, y: 370 }),
    },
    getCanvas: () => ({ clientWidth: 1_512, clientHeight: 800 }),
    project: () => ({ x: 1_000, y: 370 }),
  };

  const delta = projectLngLatElevationPixelDelta(
    map as never,
    -122.4,
    37.8,
    9_000,
  );

  assert.deepEqual(delta, { dx: 22, dy: -30 });
});

test("elevation projection falls back to the canvas center without padding", () => {
  const map = {
    transform: {
      locationToScreenPoint: () => ({ x: 800, y: 450 }),
    },
    getCanvas: () => ({ clientWidth: 1_512, clientHeight: 800 }),
    project: () => ({ x: 800, y: 450 }),
  };

  const delta = projectLngLatElevationPixelDelta(
    map as never,
    -122.4,
    37.8,
    0,
  );

  assert.deepEqual(delta, { dx: 44, dy: 50 });
});

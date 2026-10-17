import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PITCH,
  DEFAULT_ZOOM,
  fpvExitCamera,
  fpvFollowCamera,
  fpvFollowDistanceMeters,
  fpvFollowedFootprintPx,
  fpvGroundPixelsPerSecond,
  FPV_FOLLOW_PITCH,
  isWellBelowCamera,
  projectLngLatElevationPixelDelta,
} from "./camera-controller-utils";

test("the camera follows closer near the ground and further back at cruise", () => {
  assert.equal(fpvFollowDistanceMeters(0), 300);
  assert.equal(fpvFollowDistanceMeters(100), 325);
  assert.equal(fpvFollowDistanceMeters(11_000), 3_050);
  assert.equal(fpvFollowDistanceMeters(50_000), 4_000);
  assert.equal(fpvFollowDistanceMeters(Number.NaN), 300);
});

test("the follow camera sits behind the aircraft along its track, above it, looking along it", () => {
  let received:
    | {
        lng: number;
        lat: number;
        altitude: number;
        bearing: number;
        pitch: number;
      }
    | undefined;
  const map = {
    calculateCameraOptionsFromCameraLngLatAltRotation: (
      position: { lng: number; lat: number },
      altitude: number,
      bearing: number,
      pitch: number,
    ) => {
      received = {
        lng: position.lng,
        lat: position.lat,
        altitude,
        bearing,
        pitch,
      };
      return { center: [position.lng, position.lat], zoom: 12, bearing, pitch };
    },
  };

  // Flying due east at 1,000 m: the camera is 550 m back at 25° down.
  const options = fpvFollowCamera(
    map as never,
    { lng: 10, lat: 0, elevation: 1_000, track: 90 },
    0,
  );
  assert.ok(options && received);
  const back = 550 * Math.cos((25 * Math.PI) / 180);
  const up = 550 * Math.sin((25 * Math.PI) / 180);
  assert.ok(Math.abs(received.lng - (10 - back / 111_320)) < 1e-9);
  assert.ok(Math.abs(received.lat) < 1e-9);
  assert.ok(Math.abs(received.altitude - (1_000 + up)) < 1e-9);
  assert.equal(received.bearing, 90);
  assert.equal(received.pitch, FPV_FOLLOW_PITCH);
});

test("the follow camera falls back to the last bearing and rejects unusable positions", () => {
  let bearingReceived = -1;
  let calculationCount = 0;
  const map = {
    calculateCameraOptionsFromCameraLngLatAltRotation: (
      _position: unknown,
      _altitude: number,
      bearing: number,
      pitch: number,
    ) => {
      calculationCount += 1;
      bearingReceived = bearing;
      return { center: [0, 0], zoom: 10, bearing, pitch };
    },
  };

  const target = { lng: 12, lat: 48, elevation: 500, track: null };
  assert.ok(fpvFollowCamera(map as never, target, -170));
  assert.equal(bearingReceived, 190);
  const east = { elevation: 500, track: 90 };
  assert.equal(
    fpvFollowCamera(map as never, { ...east, lng: Number.NaN, lat: 48 }, 0),
    null,
  );
  assert.equal(
    fpvFollowCamera(map as never, { ...east, lng: 12, lat: 91 }, 0),
    null,
  );
  assert.equal(calculationCount, 1);
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

test("an aircraft drawn up at the camera's height is not framed", () => {
  assert.equal(isWellBelowCamera(5_000, 10_000), true);
  assert.equal(isWellBelowCamera(9_600, 10_000), false);
  assert.equal(isWellBelowCamera(14_000, 10_000), false);
});

test("leaving the cockpit eases out to an overview centred on the aircraft", () => {
  const padding = { top: 0, right: 0, bottom: 0, left: 440 };
  const withCard = fpvExitCamera({
    panelCoordinates: [-87.9, 41.98],
    cockpit: [-87.6, 41.9],
    padding,
    reduceMotion: false,
  });
  assert.deepEqual(withCard.center, [-87.9, 41.98]);
  assert.equal(withCard.zoom, DEFAULT_ZOOM);
  assert.equal(withCard.pitch, DEFAULT_PITCH);
  assert.equal(withCard.padding, padding);
  assert.ok((withCard.duration ?? 0) > 0);

  const withoutCard = fpvExitCamera({
    panelCoordinates: null,
    cockpit: [-87.6, 41.9],
    padding,
    reduceMotion: true,
  });
  assert.deepEqual(withoutCard.center, [-87.6, 41.9]);
  assert.equal(withoutCard.duration, 0);
});

test("the followed aircraft grows as the camera comes nearer, like the ground", () => {
  const drawn = { lng: 0, lat: 0, elevation: 1_000 };
  // At the follow pose, 550 m behind and above: the base size.
  const d = fpvFollowDistanceMeters(1_000);
  const back = (d * Math.cos((25 * Math.PI) / 180)) / 111_320;
  const atPose = {
    lng: 0,
    lat: -back,
    altitude: 1_000 + d * Math.sin((25 * Math.PI) / 180),
  };
  assert.ok(Math.abs(fpvFollowedFootprintPx(100, drawn, atPose) - 100) < 0.01);
  // Zoomed in to half the distance it is drawn twice as wide...
  const nearer = { lng: 0, lat: -back / 2, altitude: 1_000 + (d * Math.sin((25 * Math.PI) / 180)) / 2 };
  assert.ok(Math.abs(fpvFollowedFootprintPx(100, drawn, nearer) - 200) < 0.01);
  // ...and far away it stops shrinking at a quarter.
  assert.equal(fpvFollowedFootprintPx(100, drawn, { lng: 1, lat: 0, altitude: 50_000 }), 25);
});

test("the ground streams past on final and crawls at cruise", () => {
  const view = { pitch: 68, fovDegrees: 36.87, heightPx: 806 };
  const onFinal = fpvGroundPixelsPerSecond({
    ...view,
    cameraAltitude: 300,
    speedMps: 70,
  });
  const atCruise = fpvGroundPixelsPerSecond({
    ...view,
    cameraAltitude: 11_000,
    speedMps: 250,
  });
  assert.ok(onFinal > 150 && onFinal < 250, `${onFinal}`);
  assert.ok(atCruise > 10 && atCruise < 25, `${atCruise}`);
  // With the whole view above the horizon there is no ground to go by.
  assert.equal(
    fpvGroundPixelsPerSecond({
      ...view,
      pitch: 110,
      cameraAltitude: 300,
      speedMps: 70,
    }),
    0,
  );
});

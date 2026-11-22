import assert from "node:assert/strict";
import test from "node:test";

import {
  centerForDrawnPoint,
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

/**
 * A camera that projects linearly: 1,000 px a degree, and a point lifted a
 * metre drawn 0.01 px higher. Its centre point moves right with the left
 * padding, as MapLibre's does.
 */
function linearCamera(center: { lng: number; lat: number }) {
  const width = 1_512;
  const height = 800;
  const pxPerDegree = 1_000;
  const pxPerMeter = 0.01;
  type Camera = {
    center: { lng: number; lat: number };
    padding: { left?: number };
    readonly centerPoint: { x: number; y: number };
    clone: () => Camera;
    setCenter: (c: { lng: number; lat: number }) => void;
    setPadding: (p: { left?: number }) => void;
    locationToScreenPoint: (
      l: { lng: number; lat: number },
      terrain?: { getElevationForLngLat: () => number },
    ) => { x: number; y: number };
    setLocationAtPoint: (
      l: { lng: number; lat: number },
      p: { x: number; y: number },
    ) => void;
  };
  const make = (start: { lng: number; lat: number }, padding: { left?: number }): Camera => ({
    center: { ...start },
    padding: { ...padding },
    get centerPoint() {
      return { x: (width + (this.padding.left ?? 0)) / 2, y: height / 2 };
    },
    clone() {
      return make(this.center, this.padding);
    },
    setCenter(c) {
      this.center = { lng: c.lng, lat: c.lat };
    },
    setPadding(p) {
      this.padding = { ...p };
    },
    locationToScreenPoint(l, terrain) {
      const lift = terrain ? terrain.getElevationForLngLat() * pxPerMeter : 0;
      return {
        x: this.centerPoint.x + (l.lng - this.center.lng) * pxPerDegree,
        y: this.centerPoint.y - (l.lat - this.center.lat) * pxPerDegree - lift,
      };
    },
    setLocationAtPoint(l, p) {
      this.center = {
        lng: l.lng - (p.x - this.centerPoint.x) / pxPerDegree,
        lat: l.lat + (p.y - this.centerPoint.y) / pxPerDegree,
      };
    },
  });
  return make(center, {});
}

test("the camera goes straight to an aircraft as drawn, with the panel's padding", () => {
  const camera = linearCamera({ lng: -122.5, lat: 37.5 });
  const map = { transform: camera };

  const center = centerForDrawnPoint(map as never, -122.4, 37.6, 3_000, {
    top: 0,
    right: 0,
    bottom: 0,
    left: 448,
  });

  // Drawn 30 px above its ground point, so the centre sits 0.03° north of
  // it, where the lifted aircraft lands in the middle of the padded view.
  assert.ok(center);
  assert.ok(Math.abs(center[0] - -122.4) < 1e-9);
  assert.ok(Math.abs(center[1] - 37.63) < 1e-9);
  // Worked out on a copy: the live camera has not moved.
  assert.deepEqual(camera.center, { lng: -122.5, lat: 37.5 });
  assert.deepEqual(camera.padding, {});
});

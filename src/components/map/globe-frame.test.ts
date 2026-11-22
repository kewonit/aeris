import assert from "node:assert/strict";
import test from "node:test";

import { MapLibreOverlay } from "@deck.gl/maplibre";

import { aircraftOrientation } from "./aircraft-model-layers";
import {
  aircraftIconAngle,
  DECK_MAP_VIEW_ID,
  DECK_SPHERE_MAX_ZOOM,
  deckDrawsOnSphere,
  deckMapView,
  FIRST_PERSON_FLAT_MIN_ZOOM,
  overlayViewProps,
} from "./globe-frame";

type Vec3 = [number, number, number];

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return v.map((value) => value / length) as Vec3;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function combine(axes: [Vec3, Vec3, Vec3], [x, y, z]: Vec3): Vec3 {
  return [0, 1, 2].map(
    (i) => axes[0][i] * x + axes[1][i] * y + axes[2][i] * z,
  ) as Vec3;
}

function assertClose(actual: Vec3, expected: Vec3, label: string) {
  actual.forEach((value, i) =>
    assert.ok(
      Math.abs(value - expected[i]) < 1e-9,
      `${label} [${i}] ${value} != ${expected[i]}`,
    ),
  );
}

/** East, north, and up on deck's sphere, from project_globe_. */
function geographicAxes(lng: number, lat: number): [Vec3, Vec3, Vec3] {
  const [l, p] = [radians(lng), radians(lat)];
  return [
    [Math.cos(l), Math.sin(l), 0],
    [-Math.sin(l) * Math.sin(p), Math.cos(l) * Math.sin(p), Math.cos(p)],
    [Math.sin(l) * Math.cos(p), -Math.cos(l) * Math.cos(p), Math.sin(p)],
  ];
}

/**
 * The axes deck lays an icon's or a model's offsets out along on the
 * sphere, as project_get_orientation_matrix builds them.
 */
function deckSphereAxes(lng: number, lat: number): [Vec3, Vec3, Vec3] {
  const up = geographicAxes(lng, lat)[2];
  const x = normalize([up[1], -up[0], 0]);
  return [x, cross(up, x), up];
}

/** Which way a flat icon's nose, the top of its image, points. */
function iconNose(angle: number, axes: [Vec3, Vec3, Vec3]): Vec3 {
  // The icon shader turns the offset, then flips its y.
  const [x, y] = [0, -1];
  const [c, s] = [Math.cos(radians(angle)), Math.sin(radians(angle))];
  return combine(axes, [c * x + s * y, -(-s * x + c * y), 0]);
}

/** Which way a normalised model's nose, along +X, points. */
function modelNose(
  [pitch, yaw]: [number, number, number],
  axes: [Vec3, Vec3, Vec3],
): Vec3 {
  // The first column of deck's Rz(yaw)·Ry(pitch)·Rx(roll).
  const [p, w] = [radians(pitch), radians(yaw)];
  return combine(axes, [
    Math.cos(w) * Math.cos(p),
    Math.sin(w) * Math.cos(p),
    -Math.sin(p),
  ]);
}

function along(track: number, [east, north]: [Vec3, Vec3, Vec3]): Vec3 {
  const [c, s] = [Math.cos(radians(track)), Math.sin(radians(track))];
  return [0, 1, 2].map((i) => north[i] * c + east[i] * s) as Vec3;
}

const PLACES: [number, number][] = [
  [-122.4, 37.6],
  [0, 0],
  [151.2, -33.9],
  [-170, 64],
  [45, -60],
];
const TRACKS = [0, 45, 90, 167, 270, 330];

test("on the flat map, icons and models point along their track", () => {
  const flat: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (const track of TRACKS) {
    const expected = along(track, flat);
    assertClose(iconNose(aircraftIconAngle(track, false), flat), expected, `icon ${track}`);
    assertClose(
      modelNose(aircraftOrientation(track, 0, 0, false), flat),
      expected,
      `model ${track}`,
    );
  }
});

test("deck's sphere axes are half a turn from east and north", () => {
  for (const [lng, lat] of PLACES) {
    const [east, north, up] = geographicAxes(lng, lat);
    const [x, y, z] = deckSphereAxes(lng, lat);
    const label = `${lng},${lat}`;
    assertClose(x, east.map((v) => -v) as Vec3, `${label} x is west`);
    assertClose(y, north.map((v) => -v) as Vec3, `${label} y is south`);
    assertClose(z, up, `${label} z is up`);
  }
});

test("on the sphere, icons and models point along their track", () => {
  for (const [lng, lat] of PLACES) {
    const axes = deckSphereAxes(lng, lat);
    const geographic = geographicAxes(lng, lat);
    for (const track of TRACKS) {
      const expected = along(track, geographic);
      const label = `${lng},${lat} track ${track}`;
      assertClose(iconNose(aircraftIconAngle(track, true), axes), expected, `icon ${label}`);
      assertClose(
        modelNose(aircraftOrientation(track, 0, 0, true), axes),
        expected,
        `model ${label}`,
      );
      // Without the turn, the nose points back the way it came.
      assertClose(
        iconNose(aircraftIconAngle(track, false), axes),
        expected.map((v) => -v) as Vec3,
        `unturned icon ${label}`,
      );
    }
  }
});

test("icon angles stay within one turn", () => {
  for (const track of [0, 90, 180, 359.9, 360]) {
    for (const onSphere of [false, true]) {
      const angle = aircraftIconAngle(track, onSphere);
      assert.ok(angle >= 0 && angle < 360, `${track} ${onSphere} ${angle}`);
    }
  }
});

test("deck draws on the sphere only on a globe up to its flat hand-over", () => {
  const map = (type: unknown) => ({ getProjection: () => ({ type }) });
  assert.equal(deckDrawsOnSphere(map("globe"), 2), true);
  assert.equal(deckDrawsOnSphere(map("globe"), DECK_SPHERE_MAX_ZOOM), true);
  assert.equal(deckDrawsOnSphere(map("globe"), DECK_SPHERE_MAX_ZOOM + 0.01), false);
  assert.equal(deckDrawsOnSphere(map("mercator"), 2), false);
  assert.equal(deckDrawsOnSphere({ getProjection: () => undefined }, 2), false);
  const styleless = {
    getProjection: (): { type?: unknown } => {
      throw new Error("no style");
    },
  };
  assert.equal(deckDrawsOnSphere(styleless, 2), false);
});

test("deck draws in a globe view on the globe and a flat one otherwise", () => {
  const map = (type: unknown) => ({ getProjection: () => ({ type }) });
  const styleless = {
    getProjection: (): { type?: unknown } => {
      throw new Error("no style");
    },
  };
  const globe = deckMapView(map("globe"));
  const flat = deckMapView(map("mercator"));

  assert.equal(globe.constructor.name, "GlobeView");
  assert.equal(flat.constructor.name, "MapView");
  assert.equal(deckMapView(styleless), flat);
  // The same instance each time, so deck never sees a change of view.
  assert.equal(deckMapView(map("globe")), globe);
  assert.equal(globe.id, DECK_MAP_VIEW_ID);
  assert.equal(flat.id, DECK_MAP_VIEW_ID);
});

test("the globe view keeps the first person aircraft in front of its near plane", () => {
  // First person at cruise: the map's centre is far ahead on the ground, and
  // the aircraft about a seventh of a viewport height from the camera.
  const FIRST_PERSON_DEPTH = 0.14;
  const view = deckMapView({ getProjection: () => ({ type: "globe" }) });
  for (const zoom of [8, 11.5, 13]) {
    const viewport = view.makeViewport({
      width: 800,
      height: 1200,
      viewState: { longitude: -122, latitude: 40, zoom, pitch: 68, bearing: 0 },
    });
    const m = viewport!.projectionMatrix;
    const near = m[14] / (m[10] - 1);
    assert.ok(near < FIRST_PERSON_DEPTH / 2, `zoom ${zoom}: near ${near}`);
  }
});

test("the overlay takes our view in place of its own", () => {
  const stub = { getProjection: () => ({ type: "globe" }) };
  const view = deckMapView(stub);
  // _getViews is how the overlay picks deck's views at every map render. A
  // renamed id would add its own globe view beside ours and draw twice.
  type WithViews = { _getViews(map: unknown): unknown };
  const ours = new MapLibreOverlay(
    overlayViewProps(stub),
  ) as unknown as WithViews;
  const theirs = new MapLibreOverlay({}) as unknown as WithViews;
  assert.equal(ours._getViews(stub), view);
  assert.equal((theirs._getViews(stub) as { id: string }).id, DECK_MAP_VIEW_ID);
});

test("first person close in is drawn flat, even on the globe", () => {
  const globe = { getProjection: () => ({ type: "globe" }) };
  const flatView = deckMapView({ getProjection: () => ({ type: "mercator" }) });
  const z = FIRST_PERSON_FLAT_MIN_ZOOM;

  // Cruise first person sits around zoom 11: flat, in the precise view.
  assert.equal(deckDrawsOnSphere(globe, z + 1.2, true), false);
  assert.equal(deckMapView(globe, { firstPerson: true, zoom: z + 1.2 }), flatView);
  // Flying in from the whole globe it stays on the sphere until close in.
  assert.equal(deckDrawsOnSphere(globe, z - 0.5, true), true);
  assert.notEqual(deckMapView(globe, { firstPerson: true, zoom: z - 0.5 }), flatView);
  // Out of first person nothing changes.
  assert.equal(deckDrawsOnSphere(globe, z + 1.2), true);
  assert.notEqual(deckMapView(globe, { zoom: z + 1.2 }), flatView);
});

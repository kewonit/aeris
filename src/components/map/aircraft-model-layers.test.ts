import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  type AircraftLayerParams,
  aircraftOrientation,
  buildAircraftModelLayers,
  modelTailShareFor,
  normalizeScene,
} from "./aircraft-model-layers";
import {
  ALL_MODEL_KEYS,
  type AircraftModelKey,
  modelNoseTurn,
} from "./aircraft-model-mapping";
import type { AircraftScreenSize } from "./aircraft-size";

type Vec3 = [number, number, number];

function assertClose(actual: number[], expected: number[], label = "") {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-9,
      `${label} [${index}] ${value} != ${expected[index]}`,
    ),
  );
}

/** A column-major 4x4 matrix applied to a point. */
function transformPoint(matrix: number[], [x, y, z]: Vec3): Vec3 {
  return [0, 1, 2].map(
    (row) =>
      matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z +
      matrix[12 + row],
  ) as Vec3;
}

/** The rotation and scale of a column-major 4x4 matrix, as rows. */
function linearPart(matrix: number[]): number[][] {
  return [0, 1, 2].map((row) => [matrix[row], matrix[4 + row], matrix[8 + row]]);
}

/** deck's orientation matrix, Rz(yaw)·Ry(pitch)·Rx(roll), as rows. */
function deckRotation([pitch, yaw, roll]: [number, number, number]) {
  const [p, w, r] = [pitch, yaw, roll].map((degrees) => (degrees * Math.PI) / 180);
  const [sp, cp, sw, cw, sr, cr] = [
    Math.sin(p), Math.cos(p), Math.sin(w), Math.cos(w), Math.sin(r), Math.cos(r),
  ];
  return [
    [cw * cp, -sw * cr + cw * sp * sr, sw * sr + cw * sp * cr],
    [sw * cp, cw * cr + sw * sp * sr, -cw * sr + sw * sp * cr],
    [-sp, cp * sr, cp * cr],
  ];
}

function rotate(rows: number[][], vector: Vec3): Vec3 {
  return rows.map(
    (row) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2],
  ) as Vec3;
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length) as Vec3;
}

function makeNarrowbodyFlight(): FlightState {
  return {
    icao24: "abc123",
    longitude: 8.1,
    latitude: 50.0,
    baroAltitude: 1040,
    trueTrack: 90,
    velocity: 220,
    category: 4,
    typeCode: "A320",
    onGround: false,
  } as FlightState;
}

function narrowbodyParams(
  aircraftSizes: Map<string, AircraftScreenSize>,
): AircraftLayerParams {
  const flight = makeNarrowbodyFlight();
  return {
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    frameCounter: 0,
    dataVersion: 0,
    layersVisible: true,
    globeFade: 1,
    aircraftSizes,
    altitudeDisplayMode: "realistic",
    altColors: false,
    defaultColor: [255, 255, 255, 255],
    pitchByIcao: new Map(),
    bankByIcao: new Map(),
    handleHover: () => {},
    handleClick: () => {},
  };
}

function narrowbodyLayer(aircraftSizes: Map<string, AircraftScreenSize>) {
  const flight = makeNarrowbodyFlight();
  const layers = buildAircraftModelLayers(narrowbodyParams(aircraftSizes));
  const layer = layers.find(
    (candidate) => candidate.props.id === "flight-aircraft-narrowbody",
  );
  assert.ok(layer);
  return { flight, props: layer.props };
}

test("a model sits on its reported position", () => {
  const { flight, props } = narrowbodyLayer(new Map());
  const position = props.getPosition as unknown as (
    d: FlightState,
  ) => number[];

  assert.deepEqual(position(flight).slice(0, 2), [8.1, 50.0]);
});

test("a model is drawn at its footprint, less perspective enlargement", () => {
  const { flight, props } = narrowbodyLayer(
    new Map([
      ["abc123", { footprintPx: 24, magnification: 1.5, tailShare: 0.4 }],
    ]),
  );
  const scale = props.getScale as unknown as (d: FlightState) => number[];

  assert.equal(props.sizeMinPixels, 1);
  assert.equal(props.sizeMaxPixels, 1);
  assert.deepEqual(scale(flight), [16, 16, 16]);
});

test("a model is drawn at its altitude's presentation height", () => {
  const flight = { ...makeNarrowbodyFlight(), baroAltitude: 11_000 };
  const layers = buildAircraftModelLayers({
    ...narrowbodyParams(new Map()),
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    altitudeDisplayMode: "presentation",
  });
  const layer = layers.find(
    (candidate) => candidate.props.id === "flight-aircraft-narrowbody",
  );
  const position = layer!.props.getPosition as unknown as (
    d: FlightState,
  ) => number[];

  assert.equal(position(flight)[2], 50_400);
});

test("a model still loading is handed back to deck untouched", () => {
  const { props } = narrowbodyLayer(new Map());
  const getScene = props.getScene as unknown as (scenegraph: unknown) => unknown;

  assert.equal(getScene(null), null);
});

test("a loaded model's chosen scene is normalised", () => {
  const { props } = narrowbodyLayer(new Map());
  const getScene = props.getScene as unknown as (scenegraph: unknown) => unknown;
  let matrix: number[] = [];
  const scene = {
    getBounds: () => [
      [-2, 0, -1],
      [2, 1, 1],
    ],
    setMatrix: (next: number[]) => {
      matrix = next;
    },
  };

  assert.equal(getScene({ scenes: [scene] }), scene);
  assert.equal(matrix[0], 0.25);
});

test("normalizing a scene centres it and scales its footprint to one unit", () => {
  let matrix: number[] = [];
  const scene = {
    getBounds: () => [
      [-30, -5, -64],
      [50, 18, 9],
    ],
    setMatrix: (next: number[]) => {
      matrix = next;
    },
  };

  const footprint = normalizeScene(scene);

  const scale = 1 / 80;
  assert.equal(footprint?.x, 1);
  assert.ok(Math.abs(footprint!.z - 73 / 80) < 1e-12);
  assertClose(matrix, [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    -10 * scale, -6.5 * scale, 27.5 * scale, 1,
  ]);
});

test("normalizing turns a model so its nose points along +X", () => {
  let matrix: number[] = [];
  // Nose at +Z, eight units long and two wide, centred off the origin.
  const scene = {
    getBounds: () => [
      [9, -0.5, 6],
      [11, 0.5, 14],
    ],
    setMatrix: (next: number[]) => {
      matrix = next;
    },
  };

  const footprint = normalizeScene(scene, 90);

  assert.deepEqual(footprint, { x: 1, z: 0.25 });
  assertClose(transformPoint(matrix, [10, 0, 14]), [0.5, 0, 0]);
  assertClose(transformPoint(matrix, [11, 0, 10]), [0, 0, -0.125]);
});

test("the tail share runs along the normalised fuselage", () => {
  assert.equal(modelTailShareFor({ x: 1, z: 0.78 }), 0.45);
});

// Where each model's nose points in its own file, from the mapping notes.
const NOSE_IN_FILE: Record<AircraftModelKey, Vec3> = {
  b737: [0, 0, -1],
  narrowbody: [1, 0, 0],
  generic: [1, 0, 0],
  "widebody-2eng": [0, 0, 1],
  "widebody-4eng": [0, 0, 1],
  a380: [0, 0, 1],
  "regional-jet": [0, 0, 1],
  bizjet: [0, 0, 1],
  helicopter: [0, 0, 1],
  glider: [0, 0, 1],
  fighter: [0, 0, 1],
  turboprop: [0, 0, 1],
  "light-prop": [0, 0, 1],
  drone: [0, 0, 1],
};

test("every model climbs nose up and banks wing down along its track", () => {
  for (const key of ALL_MODEL_KEYS) {
    let matrix: number[] = [];
    normalizeScene(
      {
        getBounds: () => [
          [-1, -1, -1],
          [1, 1, 1],
        ],
        setMatrix: (next: number[]) => {
          matrix = next;
        },
      },
      modelNoseTurn(key),
    );
    const nose = NOSE_IN_FILE[key];
    // glTF is Y-up, so the right wing is the nose crossed with up.
    const rightWing: Vec3 = [-nose[2], 0, nose[0]];
    const place = (vector: Vec3, orientation: [number, number, number]) =>
      normalize(
        rotate(deckRotation(orientation), rotate(linearPart(matrix), vector)),
      );

    const eastbound = aircraftOrientation(90, 0, 0);
    assertClose(place(nose, eastbound), [1, 0, 0], key);
    assertClose(place(rightWing, eastbound), [0, -1, 0], key);
    assertClose(place(nose, aircraftOrientation(0, 0, 0)), [0, 1, 0], key);

    const climbing = aircraftOrientation(90, -10, 0);
    assert.ok(place(nose, climbing)[2] > 0.17, `${key} climbs nose up`);
    assert.ok(Math.abs(place(rightWing, climbing)[2]) < 1e-9, `${key} level`);

    const turningRight = aircraftOrientation(90, 0, 20);
    assert.ok(place(rightWing, turningRight)[2] < -0.34, `${key} banks`);
    assert.ok(Math.abs(place(nose, turningRight)[2]) < 1e-9, `${key} nose`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  type AircraftLayerParams,
  buildAircraftModelLayers,
  modelTailShareFor,
  normalizeScene,
} from "./aircraft-model-layers";
import type { AircraftScreenSize } from "./aircraft-size";

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
    elevScale: 1,
    heightCeiling: Infinity,
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

test("a model is kept under the height ceiling", () => {
  const flight = { ...makeNarrowbodyFlight(), baroAltitude: 11_000 };
  const layers = buildAircraftModelLayers({
    ...narrowbodyParams(new Map()),
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    heightCeiling: 6_000,
  });
  const layer = layers.find(
    (candidate) => candidate.props.id === "flight-aircraft-narrowbody",
  );
  const position = layer!.props.getPosition as unknown as (
    d: FlightState,
  ) => number[];

  assert.ok(position(flight)[2] < 6_000);
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
  assert.deepEqual(matrix, [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    -10 * scale, -6.5 * scale, 27.5 * scale, 1,
  ]);
});

test("the tail share follows each model's fuselage axis", () => {
  const footprint = { x: 1, z: 0.78 };

  // Turned 90°, the fuselage lies along X; otherwise along Z.
  assert.equal(modelTailShareFor("narrowbody", footprint), 0.45);
  const lightProp = modelTailShareFor("light-prop", footprint);
  assert.ok(Math.abs(lightProp - 0.351) < 1e-9);
});

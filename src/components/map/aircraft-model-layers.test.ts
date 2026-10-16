import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import {
  buildAircraftModelLayers,
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

function narrowbodyLayer(aircraftSizes: Map<string, AircraftScreenSize>) {
  const flight = makeNarrowbodyFlight();
  const layers = buildAircraftModelLayers({
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    frameCounter: 0,
    dataVersion: 0,
    layersVisible: true,
    globeFade: 1,
    elevScale: 1,
    aircraftSizes,
    altitudeDisplayMode: "realistic",
    altColors: false,
    defaultColor: [255, 255, 255, 255],
    pitchByIcao: new Map(),
    bankByIcao: new Map(),
    handleHover: () => {},
    handleClick: () => {},
  });
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
    new Map([["abc123", { footprintPx: 24, magnification: 1.5 }]]),
  );
  const scale = props.getScale as unknown as (d: FlightState) => number[];

  assert.equal(props.sizeMinPixels, 1);
  assert.equal(props.sizeMaxPixels, 1);
  assert.deepEqual(scale(flight), [16, 16, 16]);
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

  normalizeScene(scene);

  const scale = 1 / 80;
  assert.deepEqual(matrix, [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    -10 * scale, -6.5 * scale, 27.5 * scale, 1,
  ]);
});

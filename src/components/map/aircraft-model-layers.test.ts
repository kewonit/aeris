import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import { buildAircraftModelLayers } from "./aircraft-model-layers";
import { getAircraftModelCalibration } from "./aircraft-model-calibration";
import { BASE_3D_MODEL_SIZE } from "./aircraft-model-size";
import { offsetPositionByTrack } from "./flight-math";

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

function findNarrowbodyLayer(layers: unknown[]) {
  return layers.find(
    (layer) =>
      (layer as { props: { id: string } }).props.id ===
      "flight-aircraft-narrowbody",
  ) as {
    props: {
      sizeScale: number;
    };
  };
}

test("offsetPositionByTrack shifts eastbound aircraft backward along track", () => {
  const positioned = offsetPositionByTrack({ lng: 8.1, lat: 50.0 }, 90, -18);

  assert.ok(positioned.lng < 8.1);
  assert.equal(positioned.lat, 50.0);
});

test("buildAircraftModelLayers shifts the rendered aircraft behind the live anchor", () => {
  const flight = makeNarrowbodyFlight();
  const layers = buildAircraftModelLayers({
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    frameCounter: 0,
    dataVersion: 0,
    layersVisible: true,
    globeFade: 1,
    elevScale: 1,
    currentZoom: 6,
    altitudeDisplayMode: "presentation",
    altColors: false,
    defaultColor: [255, 255, 255, 255],
    pitchByIcao: new Map(),
    bankByIcao: new Map(),
    handleHover: () => {},
    handleClick: () => {},
  });

  const aircraftLayer = layers[0] as unknown as {
    props: {
      getPosition: (flightState: FlightState) => [number, number, number];
      getOrientation: (flightState: FlightState) => [number, number, number];
    };
  };

  const position = aircraftLayer.props.getPosition(flight);
  const orientation = aircraftLayer.props.getOrientation(flight);
  const calibration = getAircraftModelCalibration("narrowbody");

  assert.ok(position[0] < 8.1);
  assert.equal(orientation[2], calibration.baseRoll);
});

test("buildAircraftModelLayers uses the smaller 3D base size at the reference zoom", () => {
  const flight = makeNarrowbodyFlight();
  const layers = buildAircraftModelLayers({
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    frameCounter: 0,
    dataVersion: 0,
    layersVisible: true,
    globeFade: 1,
    elevScale: 1,
    currentZoom: 6,
    altitudeDisplayMode: "presentation",
    altColors: false,
    defaultColor: [255, 255, 255, 255],
    pitchByIcao: new Map(),
    bankByIcao: new Map(),
    handleHover: () => {},
    handleClick: () => {},
  });

  const aircraftLayer = findNarrowbodyLayer(layers);

  const calibration = getAircraftModelCalibration("narrowbody");
  assert.ok(aircraftLayer);
  assert.equal(
    aircraftLayer.props.sizeScale,
    BASE_3D_MODEL_SIZE * calibration.displayScale,
  );
});

test("buildAircraftModelLayers increases 3D sizeScale as zoom decreases", () => {
  const flight = makeNarrowbodyFlight();
  const nearLayers = buildAircraftModelLayers({
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    frameCounter: 0,
    dataVersion: 0,
    layersVisible: true,
    globeFade: 1,
    elevScale: 1,
    currentZoom: 6,
    altitudeDisplayMode: "presentation",
    altColors: false,
    defaultColor: [255, 255, 255, 255],
    pitchByIcao: new Map(),
    bankByIcao: new Map(),
    handleHover: () => {},
    handleClick: () => {},
  });
  const farLayers = buildAircraftModelLayers({
    rawFlights: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    frameCounter: 0,
    dataVersion: 0,
    layersVisible: true,
    globeFade: 1,
    elevScale: 1,
    currentZoom: 5,
    altitudeDisplayMode: "presentation",
    altColors: false,
    defaultColor: [255, 255, 255, 255],
    pitchByIcao: new Map(),
    bankByIcao: new Map(),
    handleHover: () => {},
    handleClick: () => {},
  });

  const nearLayer = findNarrowbodyLayer(nearLayers);
  const farLayer = findNarrowbodyLayer(farLayers);

  assert.equal(farLayer.props.sizeScale, nearLayer.props.sizeScale * 2);
});

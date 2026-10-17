import assert from "node:assert/strict";
import test from "node:test";

import { WebMercatorViewport } from "@deck.gl/core";

import type { FlightState } from "@/lib/opensky";

import {
  aircraftFootprintPixels,
  aircraftTailShare,
  aircraftWingspanMeters,
  altitudeMagnification,
  metersPerPixel,
  recordModelTailShare,
} from "./aircraft-size";

test("big jets stay in proportion with light aircraft at city zoom", () => {
  const lightAircraft = aircraftFootprintPixels(11, 10, 37.6);
  const narrowbody = aircraftFootprintPixels(36, 10, 37.6);
  const a380 = aircraftFootprintPixels(80, 10, 37.6);

  assert.ok(lightAircraft < narrowbody && narrowbody < a380);
  assert.ok(a380 <= 30);
  assert.ok(a380 / lightAircraft < 2);
});

test("aircraft shrink a little when zoomed out", () => {
  const zoomedOut = aircraftFootprintPixels(36, 5, 37.6);
  assert.ok(zoomedOut < aircraftFootprintPixels(36, 10, 37.6));
});

test("zoomed in to an airport, aircraft are drawn at their real size", () => {
  const zoom = 18;
  assert.equal(
    aircraftFootprintPixels(36, zoom, 37.6),
    36 / metersPerPixel(zoom, 37.6),
  );
});

test("a type's own wingspan beats its model class", () => {
  const flight = (typeCode: string) =>
    ({ icao24: typeCode, typeCode, category: 6 }) as FlightState;

  assert.equal(aircraftWingspanMeters(flight("B77W")), 65);
  assert.equal(aircraftWingspanMeters(flight("b77w")), 65);
});

test("perspective enlargement is measured from the camera", () => {
  const viewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: -122.4,
    latitude: 37.6,
    zoom: 11,
    pitch: 0,
  });
  const project = (position: [number, number, number]) =>
    viewport.project(position);

  assert.equal(altitudeMagnification(project, -122.4, 37.6, 0, 0), 1);
  const raised = altitudeMagnification(project, -122.4, 37.6, 20_000, 0);
  assert.ok(raised > 1.2 && raised < 40);
});

test("in a tilted, turned view the enlargement is the depth ratio", () => {
  const viewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: -122.4,
    latitude: 37.6,
    zoom: 11,
    pitch: 50,
    bearing: 35,
  });
  const project = (position: [number, number, number]) =>
    viewport.project(position);
  const magnification = altitudeMagnification(
    project,
    -122.4,
    37.6,
    8_000,
    35,
  );

  // A tiny cube scales equally on screen in every direction, so its
  // across-view width ratio is the true enlargement.
  const across = (z: number) => {
    const radians = (35 * Math.PI) / 180;
    const a = project([-122.4, 37.6, z]);
    const b = project([
      -122.4 + (0.0001 * Math.cos(radians)) / Math.cos((37.6 * Math.PI) / 180),
      37.6 - 0.0001 * Math.sin(radians),
      z,
    ]);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  assert.ok(Math.abs(magnification - across(8_000) / across(0)) < 0.01);
});

test("a loaded model's tail share replaces the default", () => {
  const flight = {
    icao24: "tail1",
    typeCode: "B738",
    category: 3,
  } as FlightState;

  assert.equal(aircraftTailShare(flight, false), 0.4);
  recordModelTailShare("b737", 0.43);
  assert.equal(aircraftTailShare(flight, true), 0.43);
  assert.equal(aircraftTailShare(flight, false), 0.4);
});

import assert from "node:assert/strict";
import test from "node:test";

import { WebMercatorViewport } from "@deck.gl/core";

import type { FlightState } from "@/lib/opensky";

import {
  aircraftFootprintPixels,
  fpvFootprintPixels,
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

test("aircraft keep shrinking as the map zooms out, down to a floor", () => {
  const size = (zoom: number) => aircraftFootprintPixels(36, zoom, 37.6);

  // A narrowbody's full symbol is 21.2 px, from zoom 10 up to real size.
  assert.ok(Math.abs(size(10) - 21.2) < 1e-9);
  assert.equal(size(11), size(10));
  for (let zoom = 4; zoom < 10; zoom += 1) {
    assert.ok(size(zoom) < size(zoom + 1), `smaller at zoom ${zoom}`);
  }
  assert.ok(Math.abs(size(5) - 21.2 * 0.5) < 1e-9);
  assert.ok(Math.abs(size(2) - 21.2 * 0.35) < 1e-9);
  assert.equal(size(0), size(2));
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

test("from the cockpit an aircraft is its real size, between a dot and a close pass", () => {
  // A 1,200 px focal length and 10 m per pixel at the map's centre.
  const size = (distance: number) => fpvFootprintPixels(36, distance, 1_200, 10);

  // Close enough to see at real size: 36 m, 3.6 px at the centre's scale.
  assert.ok(Math.abs(size(5_000) - 3.6) < 1e-9);
  // Far off it would be 1.4 px, so it is kept a 4 px dot at that distance.
  assert.ok(Math.abs(size(30_000) - (4 * 30_000) / 1_200 / 10) < 1e-9);
  // A pass at 100 m would be 432 px, so it is held to 160 px.
  assert.ok(Math.abs(size(100) - (160 * 100) / 1_200 / 10) < 1e-9);
});

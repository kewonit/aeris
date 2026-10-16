import assert from "node:assert/strict";
import test from "node:test";

import { WebMercatorViewport } from "@deck.gl/core";

import type { FlightState } from "@/lib/opensky";

import {
  aircraftFootprintPixels,
  aircraftWingspanMeters,
  altitudeMagnification,
  metersPerPixel,
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

  assert.equal(altitudeMagnification(project, -122.4, 37.6, 0), 1);
  const raised = altitudeMagnification(project, -122.4, 37.6, 20_000);
  assert.ok(raised > 1.2 && raised < 40);
});

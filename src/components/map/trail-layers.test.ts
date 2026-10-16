import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";
import type { TrailSample, TrailTrack } from "@/lib/trails/types";

import type { AircraftScreenSize } from "./aircraft-size";
import { metersPerPixel } from "./aircraft-size";
import { horizontalDistanceFromLngLat } from "./flight-math";
import type { TrailHeadAnchor } from "./trail-geometry";
import {
  buildTrailHead,
  buildTrailLayers,
  createTrailRenderCache,
  type TrailLayerParams,
} from "./trail-layers";

function flight(overrides: Partial<FlightState> = {}): FlightState {
  return {
    icao24: "abc123",
    callsign: "TST123",
    registrationCountry: null,
    longitude: -121.99,
    latitude: 37.5,
    baroAltitude: 3_000,
    onGround: false,
    velocity: 220,
    trueTrack: 90,
    verticalRate: 0,
    geoAltitude: 3_050,
    squawk: null,
    spiFlag: false,
    positionSource: "adsb",
    category: 3,
    provenance: {
      responseTime: 0,
      observationTime: 0,
      positionAgeSeconds: 0,
      contributingSources: [],
      positionProvider: "adsb.lol",
    },
    ...overrides,
  };
}

const ANCHOR: TrailHeadAnchor = {
  vertex: [-122, 37.5, 2_960],
  tangent: [1, 0],
  color: [200, 120, 80, 180],
  headAlpha: 210,
};

const HEAD_OPTIONS = {
  altColors: true,
  altitudeDisplayMode: "realistic" as const,
  elevScale: 1,
  defaultColor: [180, 220, 255, 200] as [number, number, number, number],
  zoom: 14,
};

const SIZE: AircraftScreenSize = { footprintPx: 24, magnification: 1 };
const HALF_LENGTH = 0.45 * 24 * metersPerPixel(14, 37.5);

/** Unit direction of the head's last segment, as [east, north]. */
function arrival(path: number[][]): [number, number] {
  const [from, to] = path.slice(-2);
  const east = (to[0] - from[0]) * Math.cos((37.5 * Math.PI) / 180);
  const north = to[1] - from[1];
  const length = Math.hypot(east, north);
  return [east / length, north / length];
}

test("the head runs out of the trail and into the tail", () => {
  const aircraft = flight();
  const head = buildTrailHead(ANCHOR, aircraft, SIZE, HEAD_OPTIONS);
  assert.ok(head);

  const start = head.path[0];
  const end = head.path.at(-1)!;
  assert.deepEqual(start, ANCHOR.vertex);
  assert.ok(end[0] < aircraft.longitude!);
  const gap = horizontalDistanceFromLngLat(
    end[0],
    end[1],
    aircraft.longitude!,
    aircraft.latitude!,
  );
  assert.ok(Math.abs(gap - HALF_LENGTH) < 0.5);
  assert.equal(end[2], 3_000);
  assert.deepEqual(head.colors[0], ANCHOR.color);
  assert.equal(head.colors.at(-1)![3], ANCHOR.headAlpha);
});

test("a crabbing aircraft still takes the trail in along its fuselage", () => {
  const head = buildTrailHead(
    ANCHOR,
    flight({ trueTrack: 60 }),
    SIZE,
    HEAD_OPTIONS,
  );
  assert.ok(head);

  const [east, north] = arrival(head.path);
  const heading = (60 * Math.PI) / 180;
  assert.ok(east * Math.sin(heading) + north * Math.cos(heading) > 0.98);
});

test("a heading back towards the trail gets a straight join, not a loop", () => {
  const head = buildTrailHead(
    ANCHOR,
    flight({ trueTrack: 270 }),
    SIZE,
    HEAD_OPTIONS,
  );

  assert.equal(head?.path.length, 2);
});

test("no head is drawn while the aircraft still covers the trail's end", () => {
  const nearby = flight({ longitude: -122 + 20 / 88_300 });
  assert.equal(buildTrailHead(ANCHOR, nearby, SIZE, HEAD_OPTIONS), null);
});

function eastbound(index: number): TrailSample {
  return {
    t: 1_000_000 + index * 5_000,
    lng: -122 + index * 0.0125,
    lat: 37.5,
    alt: 3_000,
    onGround: false,
  };
}

test("trails are drawn only for aircraft on screen, and unchanged trails keep their data", () => {
  const trackFor = (icao24: string, revision: number): TrailTrack => ({
    icao24,
    parts: [Array.from({ length: 5 }, (_, index) => eastbound(index))],
    revision,
    hasHistory: false,
  });
  const trailMap = new Map([
    ["abc123", trackFor("abc123", 1)],
    ["def456", trackFor("def456", 2)],
  ]);
  const params: TrailLayerParams = {
    ...HEAD_OPTIONS,
    flights: [flight({ longitude: eastbound(4).lng })],
    aircraftSizes: new Map([["abc123", SIZE]]),
    trailMap,
    selectedIcao24: null,
    trailMinutes: 5,
    thickness: 1,
    opacity: 1,
    cache: createTrailRenderCache(),
  };

  const [bodies, heads] = buildTrailLayers(params);
  assert.equal((bodies.props.data as unknown[]).length, 1);
  assert.equal((heads.props.data as unknown[]).length, 1);

  const [again] = buildTrailLayers(params);
  assert.equal(again.props.data, bodies.props.data);
});

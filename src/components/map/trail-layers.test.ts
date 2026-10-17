import assert from "node:assert/strict";
import test from "node:test";

import { altitudeToColor } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";
import type { TrailSample, TrailTrack } from "@/lib/trails/types";

import { aircraftColor } from "./aircraft-appearance";
import type { AircraftScreenSize } from "./aircraft-size";
import { metersPerPixel } from "./aircraft-size";
import { horizontalDistanceFromLngLat } from "./flight-math";
import type { TrailLead } from "./trail-geometry";
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

/** An eastbound lead ending at -122, 0.01° (about 880 m) west of the aircraft. */
const LEAD: TrailLead = {
  path: [
    [-122.02, 37.5, 2_960],
    [-122.01, 37.5, 2_960],
    [-122, 37.5, 2_960],
  ],
  colors: [
    [200, 120, 80, 150],
    [200, 120, 80, 170],
    [200, 120, 80, 180],
  ],
  tangents: [
    [1, 0],
    [1, 0],
    [1, 0],
  ],
  headAlpha: 210,
};

const HEAD_OPTIONS = {
  altColors: true,
  altitudeDisplayMode: "realistic" as const,
  defaultColor: [180, 220, 255, 200] as [number, number, number, number],
  zoom: 14,
};

const SIZE: AircraftScreenSize = {
  footprintPx: 24,
  magnification: 1,
  tailShare: 0.45,
};
const HALF_LENGTH = 0.45 * 24 * metersPerPixel(14, 37.5);

/** Unit direction of the head's last segment, as [east, north]. */
function arrival(path: number[][]): [number, number] {
  const [from, to] = path.slice(-2);
  const east = (to[0] - from[0]) * Math.cos((37.5 * Math.PI) / 180);
  const north = to[1] - from[1];
  const length = Math.hypot(east, north);
  return [east / length, north / length];
}

function gapToAircraft(vertex: number[], aircraft: FlightState) {
  return horizontalDistanceFromLngLat(
    vertex[0],
    vertex[1],
    aircraft.longitude!,
    aircraft.latitude!,
  );
}

test("the head redraws the lead and runs on into the tail", () => {
  const aircraft = flight();
  const head = buildTrailHead(LEAD, aircraft, SIZE, HEAD_OPTIONS);
  assert.ok(head);

  assert.deepEqual(head.path.slice(0, 3), LEAD.path);
  assert.deepEqual(head.colors.slice(0, 3), LEAD.colors);
  const end = head.path.at(-1)!;
  assert.ok(end[0] < aircraft.longitude!);
  assert.ok(Math.abs(gapToAircraft(end, aircraft) - HALF_LENGTH) < 0.5);
  assert.equal(end[2], 3_000);
  assert.equal(head.colors.at(-1)![3], LEAD.headAlpha);
});

test("a crabbing aircraft still takes the trail in along its fuselage", () => {
  const head = buildTrailHead(
    LEAD,
    flight({ trueTrack: 60 }),
    SIZE,
    HEAD_OPTIONS,
  );
  assert.ok(head);

  const [east, north] = arrival(head.path);
  const heading = (60 * Math.PI) / 180;
  assert.ok(east * Math.sin(heading) + north * Math.cos(heading) > 0.98);
});

test("over the lead's end, the head starts further back and still meets the tail", () => {
  const aircraft = flight({ longitude: -122 + 20 / 88_300, trueTrack: 80 });
  const head = buildTrailHead(LEAD, aircraft, SIZE, HEAD_OPTIONS);
  assert.ok(head);

  // The lead's last vertex is under the aircraft, so it is dropped.
  assert.deepEqual(head.path.slice(0, 2), LEAD.path.slice(0, 2));
  assert.ok(!head.path.some((vertex) => vertex[0] === LEAD.path[2][0]));
  assert.ok(Math.abs(gapToAircraft(head.path.at(-1)!, aircraft) - HALF_LENGTH) < 0.5);
  const [east, north] = arrival(head.path);
  const heading = (80 * Math.PI) / 180;
  assert.ok(east * Math.sin(heading) + north * Math.cos(heading) > 0.98);
});

test("an aircraft that has turned back still takes the trail into its tail", () => {
  const aircraft = flight({ trueTrack: 270 });
  const head = buildTrailHead(LEAD, aircraft, SIZE, HEAD_OPTIONS);
  assert.ok(head);

  assert.deepEqual(head.path[0], LEAD.path[0]);
  const end = head.path.at(-1)!;
  assert.ok(Math.abs(gapToAircraft(end, aircraft) - HALF_LENGTH) < 0.5);
  const [east, north] = arrival(head.path);
  assert.ok(-east > 0.98 && Math.abs(north) < 0.2);
});

test("an aircraft covering its whole lead still takes the trail into its tail", () => {
  // Slow and turning: every lead vertex is within the drawn model.
  const aircraft = flight({ longitude: -122.005, latitude: 37.5005, trueTrack: 20 });
  const big: AircraftScreenSize = { ...SIZE, footprintPx: 400 };
  const head = buildTrailHead(LEAD, aircraft, big, HEAD_OPTIONS);
  assert.ok(head);

  assert.deepEqual(head.path[0], LEAD.path[0]);
  const halfLength = 0.45 * 400 * metersPerPixel(14, 37.5);
  assert.ok(
    Math.abs(gapToAircraft(head.path.at(-1)!, aircraft) - halfLength) < 0.5,
  );
});

test("the head ends in the aircraft's own colour", () => {
  const aircraft = flight({ category: 2 });
  const head = buildTrailHead(LEAD, aircraft, SIZE, HEAD_OPTIONS);

  const [r, g, b] = aircraftColor(altitudeToColor(3_000), aircraft);
  assert.deepEqual(head?.colors.at(-1), [r, g, b, LEAD.headAlpha]);
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
    parts: [Array.from({ length: 10 }, (_, index) => eastbound(index))],
    revision,
    hasHistory: false,
  });
  const trailMap = new Map([
    ["abc123", trackFor("abc123", 1)],
    ["def456", trackFor("def456", 2)],
  ]);
  const params: TrailLayerParams = {
    ...HEAD_OPTIONS,
    flights: [flight({ longitude: eastbound(9).lng })],
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

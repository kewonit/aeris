import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";
import type { TrailSample, TrailTrack } from "@/lib/trails/types";

import { getAircraftModelCalibration } from "./aircraft-model-calibration";
import { resolveModelKey } from "./aircraft-model-mapping";
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
  color: [200, 120, 80, 180],
  headAlpha: 210,
};

const HEAD_OPTIONS = {
  altColors: true,
  altitudeDisplayMode: "realistic" as const,
  elevScale: 1,
  defaultColor: [180, 220, 255, 200] as [number, number, number, number],
};

const tailGap = getAircraftModelCalibration(resolveModelKey(3, undefined))
  .tailAnchorMeters;

test("the head runs from the trail to the aircraft's tail and never past it", () => {
  const aircraft = flight();
  const head = buildTrailHead(ANCHOR, aircraft, HEAD_OPTIONS);
  assert.ok(head);

  const [start, end] = head.path;
  assert.deepEqual(start, ANCHOR.vertex);
  assert.equal(end[1], 37.5);
  assert.ok(end[0] > start[0] && end[0] < aircraft.longitude!);
  const gap = horizontalDistanceFromLngLat(
    end[0],
    end[1],
    aircraft.longitude!,
    37.5,
  );
  assert.ok(Math.abs(gap - tailGap) < 0.5);
  assert.deepEqual(head.colors[0], ANCHOR.color);
  assert.equal(head.colors[1][3], ANCHOR.headAlpha);
});

test("no head is drawn while the aircraft is still over its own tail", () => {
  const aircraft = flight({ longitude: -122 + 1e-6 });
  assert.equal(buildTrailHead(ANCHOR, aircraft, HEAD_OPTIONS), null);
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

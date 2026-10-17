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

function trackFor(icao24: string, revision: number): TrailTrack {
  return {
    icao24,
    parts: [Array.from({ length: 10 }, (_, index) => eastbound(index))],
    revision,
    hasHistory: false,
  };
}

function layerParams(overrides: Partial<TrailLayerParams> = {}): TrailLayerParams {
  return {
    ...HEAD_OPTIONS,
    flights: [flight({ longitude: eastbound(9).lng })],
    aircraftSizes: new Map([["abc123", SIZE]]),
    pitchByIcao: new Map(),
    trailMap: new Map([
      ["abc123", trackFor("abc123", 1)],
      ["def456", trackFor("def456", 2)],
    ]),
    selectedIcao24: null,
    trailMinutes: 5,
    ceilingMeters: null,
    glow: true,
    thickness: 1,
    opacity: 1,
    cache: createTrailRenderCache(),
    ...overrides,
  };
}

function layerData(layers: ReturnType<typeof buildTrailLayers>, id: string) {
  const layer = layers.find((candidate) => candidate.props.id === id);
  assert.ok(layer, id);
  return layer.props.data as unknown[];
}

test("trails are drawn only for aircraft on screen, and unchanged trails keep their data", () => {
  const params = layerParams();

  const layers = buildTrailLayers(params);
  assert.equal(layerData(layers, "flight-trails").length, 1);
  assert.equal(layerData(layers, "flight-trail-heads").length, 1);

  const again = buildTrailLayers(params);
  assert.equal(
    layerData(again, "flight-trails"),
    layerData(layers, "flight-trails"),
  );
});

test("a faint, wide glow is drawn under each trail from the same data", () => {
  const layers = buildTrailLayers(layerParams({ thickness: 2, opacity: 0.5 }));
  const glow = layers.find((layer) => layer.props.id === "flight-trail-glow")!;
  const core = layers.find((layer) => layer.props.id === "flight-trails")!;

  assert.ok(layers.indexOf(glow) < layers.indexOf(core));
  assert.equal(glow.props.data, core.props.data);
  assert.equal(glow.props.getWidth, 11);
  assert.ok(Math.abs(glow.props.opacity - 0.1) < 1e-9);
  assert.equal(glow.props.visible, true);
  assert.equal(glow.props.extensions.length, 1);
  assert.equal(core.props.extensions.length, 0);
  assert.equal(layerData(layers, "flight-trail-head-glow").length, 1);
});

test("trails have no glow from the cockpit", () => {
  const glow = buildTrailLayers(layerParams({ glow: false })).find(
    (layer) => layer.props.id === "flight-trail-glow",
  )!;

  assert.equal(glow.props.visible, false);
});

test("the glow fades out as the map zooms out, and is gone below zoom 8", () => {
  const glowAt = (zoom: number) =>
    buildTrailLayers(layerParams({ zoom })).find(
      (layer) => layer.props.id === "flight-trail-glow",
    )!.props;

  assert.equal(glowAt(7).visible, false);
  assert.equal(glowAt(8).visible, false);
  assert.ok(Math.abs(glowAt(8.75).opacity - 0.1) < 1e-9);
  assert.ok(Math.abs(glowAt(9.5).opacity - 0.2) < 1e-9);
  const core = buildTrailLayers(layerParams({ zoom: 7 })).find(
    (layer) => layer.props.id === "flight-trails",
  )!;
  assert.notEqual(core.props.visible, false);
});

test("the head leaves the lead far enough back to turn gently into the tail", () => {
  // Zoomed out, 48 px is longer than three half-lengths of a small model.
  const options = { ...HEAD_OPTIONS, zoom: 11 };
  const pixel = metersPerPixel(11, 37.5);
  const halfLength = 0.45 * 24 * pixel;
  const aircraft = flight({ longitude: -122 + 1_200 / 88_300 });
  const head = buildTrailHead(LEAD, aircraft, SIZE, options);
  assert.ok(head);

  // The lead's last vertex is 1.2 km back: clear of three half-lengths,
  // but inside 48 px, so it is dropped.
  assert.ok(1_200 < 48 * pixel && 1_200 > 3 * halfLength);
  assert.ok(!head.path.some((vertex) => vertex[0] === LEAD.path[2][0]));
});

test("an aircraft far along a straight gap is still joined to its trail", () => {
  // Two minutes of unobserved straight flight put it 26 km past the lead.
  const aircraft = flight({ longitude: -122 + 26_000 / 88_300 });
  const head = buildTrailHead(LEAD, aircraft, SIZE, HEAD_OPTIONS);
  assert.ok(head);

  assert.deepEqual(head.path.slice(0, 3), LEAD.path);
  assert.ok(Math.abs(gapToAircraft(head.path.at(-1)!, aircraft) - HALF_LENGTH) < 0.5);
});

test("the height limit hides high traffic but never the selected aircraft", () => {
  const high = flight({ longitude: eastbound(9).lng, baroAltitude: 9_000 });
  const low = flight({
    icao24: "def456",
    longitude: eastbound(9).lng,
    baroAltitude: 2_000,
  });
  const params = layerParams({
    flights: [high, low],
    aircraftSizes: new Map([
      ["abc123", SIZE],
      ["def456", SIZE],
    ]),
    ceilingMeters: 6_096,
  });

  const drawn = (layers: ReturnType<typeof buildTrailLayers>) =>
    (layerData(layers, "flight-trails") as { icao24: string }[]).map(
      (body) => body.icao24,
    );
  assert.deepEqual(drawn(buildTrailLayers(params)), ["def456"]);
  assert.deepEqual(
    drawn(buildTrailLayers({ ...params, selectedIcao24: "abc123" })).sort(),
    ["abc123", "def456"],
  );
});

test("a trail hidden by the height limit returns only once clearly below it", () => {
  const cache = createTrailRenderCache();
  const at = (baroAltitude: number) =>
    layerData(
      buildTrailLayers(
        layerParams({
          flights: [flight({ longitude: eastbound(9).lng, baroAltitude })],
          ceilingMeters: 6_000,
          cache,
        }),
      ),
      "flight-trails",
    ).length;

  assert.equal(at(5_990), 1);
  assert.equal(at(6_010), 0);
  assert.equal(at(5_990), 0);
  assert.equal(at(5_900), 1);
});

test("the join has no points under a pixel apart, and still ends at the tail", () => {
  // Zoomed out, the whole join is a few pixels long.
  const options = { ...HEAD_OPTIONS, zoom: 9 };
  const pixel = metersPerPixel(9, 37.5);
  const aircraft = flight({ longitude: -121.99, trueTrack: 70 });
  const head = buildTrailHead(LEAD, aircraft, SIZE, options);
  assert.ok(head);

  assert.equal(head.colors.length, head.path.length);
  const joinFrom = head.path.findIndex((vertex) => vertex === LEAD.path.at(-1));
  for (let index = Math.max(1, joinFrom + 1); index < head.path.length - 1; index += 1) {
    const [a, b] = [head.path[index - 1], head.path[index]];
    assert.ok(horizontalDistanceFromLngLat(a[0], a[1], b[0], b[1]) >= pixel * 0.999);
  }
  const halfLength = 0.45 * 24 * pixel;
  assert.ok(Math.abs(gapToAircraft(head.path.at(-1)!, aircraft) - halfLength) < 1);
});

test("a climbing aircraft takes the trail into its lowered tail along its fuselage", () => {
  // A 30° drawn climb, as presentation heights draw a steady climb, with
  // the model pitched nose up to match.
  const climb = (30 * Math.PI) / 180;
  const metersPerLng = 111_320 * Math.cos((37.5 * Math.PI) / 180);
  const aircraft = flight();
  const climbing: TrailLead = {
    ...LEAD,
    path: LEAD.path.map(([lng, lat]) => [
      lng,
      lat,
      3_000 - Math.tan(climb) * (aircraft.longitude! - lng) * metersPerLng,
    ]),
  };
  const head = buildTrailHead(climbing, aircraft, SIZE, HEAD_OPTIONS, -30);
  assert.ok(head);

  // It ends inside the lowered tail, not level with the centre at the fin.
  const end = head.path.at(-1)!;
  assert.ok(Math.abs(end[2] - (3_000 - HALF_LENGTH * Math.sin(climb))) < 1e-6);
  assert.ok(
    Math.abs(gapToAircraft(end, aircraft) - HALF_LENGTH * Math.cos(climb)) < 0.5,
  );
  // And climbs into it at the fuselage's angle, without a dip on the way.
  const before = head.path.at(-2)!;
  const run = horizontalDistanceFromLngLat(before[0], before[1], end[0], end[1]);
  assert.ok(Math.abs(Math.atan2(end[2] - before[2], run) - climb) < 0.02);
  for (let index = 1; index < head.path.length; index += 1) {
    assert.ok(head.path[index][2] >= head.path[index - 1][2]);
  }
});

test("a level aircraft's trail still meets its tail level", () => {
  const level: TrailLead = {
    ...LEAD,
    path: LEAD.path.map(([lng, lat]) => [lng, lat, 3_000]),
  };
  const head = buildTrailHead(level, flight(), SIZE, HEAD_OPTIONS, 0);
  assert.ok(head);

  const [before, end] = head.path.slice(-2);
  assert.equal(end[2], 3_000);
  const run = horizontalDistanceFromLngLat(before[0], before[1], end[0], end[1]);
  assert.ok(Math.abs(Math.atan2(end[2] - before[2], run)) < 0.01);
});

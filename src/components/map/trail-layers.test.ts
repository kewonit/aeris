import assert from "node:assert/strict";
import test from "node:test";

import { altitudeToColor } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";
import type { TrailSample, TrailTrack } from "@/lib/trails/types";

import { aircraftColor } from "./aircraft-appearance";
import type { AircraftScreenSize } from "./aircraft-size";
import { metersPerPixel } from "./aircraft-size";
import { horizontalDistanceFromLngLat } from "./flight-math";
import { getTrailGeometry, type TrailLead } from "./trail-geometry";
import {
  buildTrailHead,
  buildTrailLayers,
  createTrailRenderCache,
  easeHead,
  type TrailHead,
  type TrailLayerParams,
  type TrailRenderCache,
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

  // It starts where the cached trail ends, and keeps to the lead until it
  // bends away towards the aircraft.
  assert.deepEqual(head.path[0], LEAD.path[0]);
  assert.deepEqual(head.colors[0], LEAD.colors[0]);
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

  // The lead's last vertex is under the aircraft, so it is bent away.
  assert.deepEqual(head.path[0], LEAD.path[0]);
  assert.ok(!head.path.some((vertex) => vertex === LEAD.path[2]));
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

const METERS_PER_DEGREE = 111_320;
/** Half a screen pixel at the test zoom, in metres. */
const HALF_PIXEL = metersPerPixel(14, 37.5) / 2;

/** Where a vertex lies, in metres east and north of the aircraft. */
function fromAircraft([lng, lat]: number[], aircraft: FlightState): number[] {
  return [
    (lng - aircraft.longitude!) *
      METERS_PER_DEGREE *
      Math.cos((aircraft.latitude! * Math.PI) / 180),
    (lat - aircraft.latitude!) * METERS_PER_DEGREE,
  ];
}

/**
 * Points along a head at these distances back from its tail end, in
 * metres east and north of the aircraft: the head's shape as it is seen
 * travelling with the aircraft.
 */
function shapeBehindTail(
  path: number[][],
  aircraft: FlightState,
  distances = [40, 80, 160, 240, 320],
): number[][] {
  const local = path.map((vertex) => fromAircraft(vertex, aircraft));
  return distances.map((distance) => {
    let walked = 0;
    for (let index = local.length - 1; index > 0; index -= 1) {
      const [a, b] = [local[index], local[index - 1]];
      const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (walked + step >= distance) {
        const u = (distance - walked) / step;
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      }
      walked += step;
    }
    return local[0];
  });
}

function largestMove(a: number[][], b: number[][]): number {
  return Math.max(
    ...a.map((point, index) =>
      Math.hypot(point[0] - b[index][0], point[1] - b[index][1]),
    ),
  );
}

/** An eastbound lead with a vertex about every 88 m, running on past -122. */
const LONG_LEAD: TrailLead = {
  path: Array.from({ length: 31 }, (_, index) => [
    -122.02 + index * 0.001,
    37.5,
    2_960,
  ]),
  colors: Array.from({ length: 31 }, () => [200, 120, 80, 180]),
  tangents: Array.from({ length: 31 }, () => [1, 0]),
  headAlpha: 210,
};
/** 40 m north of the lead, so the join has to curve onto it. */
const BESIDE_LEAD = 37.5 + 40 / METERS_PER_DEGREE;

test("the join slides along the lead as the aircraft flies, without a jump at any vertex", () => {
  let previous: number[][] | null = null;
  // About 4.4 m a step, across several of the lead's vertices.
  for (let step = 0; step <= 80; step += 1) {
    const aircraft = flight({
      longitude: -122 + step * 0.00005,
      latitude: BESIDE_LEAD,
    });
    const head = buildTrailHead(LONG_LEAD, aircraft, SIZE, HEAD_OPTIONS);
    assert.ok(head);
    const shape = shapeBehindTail(head.path, aircraft);
    if (previous) {
      const move = largestMove(previous, shape);
      assert.ok(move < HALF_PIXEL, `step ${step}: the join moved ${move} m`);
    }
    previous = shape;
  }
});

test("the join never runs ahead of the aircraft's tail", () => {
  for (const trueTrack of [90, 75, 105]) {
    const aircraft = flight({ latitude: BESIDE_LEAD, trueTrack });
    const head = buildTrailHead(LONG_LEAD, aircraft, SIZE, HEAD_OPTIONS);
    assert.ok(head);
    const heading = (trueTrack * Math.PI) / 180;
    const ahead = (vertex: number[]) => {
      const [east, north] = fromAircraft(vertex, aircraft);
      return east * Math.sin(heading) + north * Math.cos(heading);
    };
    const tail = ahead(head.path.at(-1)!);
    for (const vertex of head.path) {
      assert.ok(ahead(vertex) <= tail + 0.01, `track ${trueTrack}`);
    }
  }
});

/** The head's points after the last one it keeps from the lead unchanged. */
function bendOf(path: number[][], lead: TrailLead): number[][] {
  let from = 0;
  path.forEach((vertex, index) => {
    if (lead.path.includes(vertex as TrailLead["path"][number])) from = index;
  });
  return path.slice(from);
}

/** Turn at each inner point, in radians per metre, east and north only. */
function curvatures(path: number[][], aircraft: FlightState): number[] {
  const local = path.map((vertex) => fromAircraft(vertex, aircraft));
  const out: number[] = [];
  for (let index = 1; index < local.length - 1; index += 1) {
    const [a, b, c] = [local[index - 1], local[index], local[index + 1]];
    const turn = Math.atan2(
      (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]),
      (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]),
    );
    const run =
      (Math.hypot(b[0] - a[0], b[1] - a[1]) +
        Math.hypot(c[0] - b[0], c[1] - b[1])) /
      2;
    out.push(Math.abs(turn) / run);
  }
  return out;
}

test("the join leaves the trail along it and enters the tail along the nose", () => {
  const degrees = (a: number[], b: number[]) =>
    (Math.acos(
      Math.min(
        1,
        (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) /
          (Math.hypot(...a) * Math.hypot(...b)),
      ),
    ) *
      180) /
    Math.PI;
  const cases = [
    { aircraft: flight({ latitude: BESIDE_LEAD }), pitch: 0 },
    { aircraft: flight({ trueTrack: 75 }), pitch: 0 },
    { aircraft: flight({ latitude: BESIDE_LEAD, trueTrack: 100 }), pitch: -4 },
  ];
  for (const { aircraft, pitch } of cases) {
    const head = buildTrailHead(LONG_LEAD, aircraft, SIZE, HEAD_OPTIONS, pitch);
    assert.ok(head);
    const bend = bendOf(head.path, LONG_LEAD).map((vertex) => [
      ...fromAircraft(vertex, aircraft),
      vertex[2],
    ]);
    const piece = (a: number[], b: number[]) =>
      [0, 1, 2].map((i) => b[i] - a[i]);
    const track = (aircraft.trueTrack! * Math.PI) / 180;
    const climb = (-pitch * Math.PI) / 180;
    const nose = [Math.sin(track), Math.cos(track), Math.tan(climb)];
    const label = `track ${aircraft.trueTrack}`;
    // Where it leaves the trail, it runs on along it...
    assert.ok(degrees(piece(bend[0], bend[1]), [1, 0, 0]) < 1, label);
    // ...its bend grows from nothing rather than starting all at once...
    const curving = curvatures(bendOf(head.path, LONG_LEAD), aircraft);
    assert.ok(curving[0] < Math.max(...curving) * 0.5, label);
    // ...and it enters the tail along the nose, at its pitch.
    assert.ok(degrees(piece(bend.at(-2)!, bend.at(-1)!), nose) < 1, label);
  }
});

test("an aircraft beside its trail is bent onto it by under 3°", () => {
  const near = buildTrailHead(
    LONG_LEAD,
    flight({ latitude: 37.5 + 4 / METERS_PER_DEGREE }),
    SIZE,
    HEAD_OPTIONS,
  );
  const aircraft = flight({ latitude: BESIDE_LEAD });
  const far = buildTrailHead(LONG_LEAD, aircraft, SIZE, HEAD_OPTIONS);
  assert.ok(near && far);

  const local = far.path.map((vertex) => fromAircraft(vertex, aircraft));
  for (let index = 1; index < local.length; index += 1) {
    const [a, b] = [local[index - 1], local[index]];
    const angle = Math.atan2(Math.abs(b[1] - a[1]), b[0] - a[0]);
    assert.ok(angle < (3 * Math.PI) / 180, `${(angle * 180) / Math.PI}°`);
  }
  // Further off the trail, the bend starts further back.
  assert.ok(
    bendOf(far.path, LONG_LEAD)[0][0] < bendOf(near.path, LONG_LEAD)[0][0],
  );
});

test("the join is drawn finely enough to look round at any zoom", () => {
  for (const zoom of [10, 12, 14, 16.5]) {
    const pixel = metersPerPixel(zoom, 37.5);
    for (const aircraft of [
      flight({ latitude: BESIDE_LEAD }),
      flight({ trueTrack: 60 }),
    ]) {
      const head = buildTrailHead(LONG_LEAD, aircraft, SIZE, {
        ...HEAD_OPTIONS,
        zoom,
      });
      assert.ok(head);
      const local = bendOf(head.path, LONG_LEAD).map((vertex) =>
        fromAircraft(vertex, aircraft),
      );
      // How far each straight piece strays from the curve it stands for.
      for (let index = 2; index < local.length; index += 1) {
        const [a, b, c] = [local[index - 2], local[index - 1], local[index]];
        const turn = Math.abs(
          Math.atan2(
            (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]),
            (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]),
          ),
        );
        const piece = Math.max(
          Math.hypot(b[0] - a[0], b[1] - a[1]),
          Math.hypot(c[0] - b[0], c[1] - b[1]),
        );
        assert.ok((piece * turn) / 8 < 0.1 * pixel, `zoom ${zoom}`);
      }
    }
  }
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

/** A sample on a steady right turn of about 11 km radius, 5 s apart. */
function turning(index: number): TrailSample {
  const angle = index * 0.06;
  return {
    t: 1_000_000 + index * 5_000,
    lng: -122 + Math.sin(angle) * 0.125,
    lat: 37.4 + Math.cos(angle) * 0.1,
    alt: 3_000,
    onGround: false,
  };
}

/**
 * The aircraft partway along that turn, flying along it, drawn 40 m north
 * of the samples' line as an interpolated aircraft can be.
 */
function turningAircraft(index: number): FlightState {
  const { lng, lat: onTurn } = turning(index);
  const lat = onTurn + 40 / METERS_PER_DEGREE;
  const angle = index * 0.06;
  const east = Math.cos(angle) * 0.125 * Math.cos((lat * Math.PI) / 180);
  const north = -Math.sin(angle) * 0.1;
  const track = (Math.atan2(east, north) * 180) / Math.PI;
  return flight({ longitude: lng, latitude: lat, trueTrack: (track + 360) % 360 });
}

test("a new sample does not move the join behind the aircraft", () => {
  const cases = [
    // Straight and level, 40 m beside the samples, 88 m short of the newest.
    {
      samples: Array.from({ length: 11 }, (_, index) => eastbound(index)),
      aircraft: flight({
        longitude: eastbound(9).lng - 0.001,
        latitude: BESIDE_LEAD,
      }),
    },
    // Turning, nearly at the newest sample, beside the samples' line.
    {
      samples: Array.from({ length: 11 }, (_, index) => turning(index)),
      aircraft: turningAircraft(8.9),
    },
  ];
  for (const [index, { samples, aircraft }] of cases.entries()) {
    const headWith = (count: number) => {
      const geometry = getTrailGeometry(
        new Map(),
        {
          icao24: "abc123",
          parts: [samples.slice(0, count)],
          revision: count,
          hasHistory: false,
        },
        {
          windowMs: null,
          altitudeDisplayMode: "realistic",
          altColors: true,
          defaultColor: HEAD_OPTIONS.defaultColor,
          appearance: aircraft,
        },
      );
      const head = buildTrailHead(geometry.lead!, aircraft, SIZE, HEAD_OPTIONS);
      assert.ok(head);
      return shapeBehindTail(head.path, aircraft);
    };
    const move = largestMove(headWith(10), headWith(11));
    assert.ok(move < HALF_PIXEL, `case ${index}: the join moved ${move} m`);
  }
});

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
    now: 0,
    ...overrides,
  };
}

function layerData(layers: ReturnType<typeof buildTrailLayers>, id: string) {
  const layer = layers.find((candidate) => candidate.props.id === id);
  assert.ok(layer, id);
  return layer.props.data as unknown[];
}

test("when a new sample reshapes the join, it eases there over a quarter second", () => {
  const aircraft = turningAircraft(8.9);
  const samples = Array.from({ length: 10 }, (_, index) => turning(index));
  // The next sample shows a harder turn than the one so far.
  const harder = turning(10);
  harder.lat -= 300 / METERS_PER_DEGREE;
  const trackOf = (parts: TrailSample[], revision: number): TrailTrack => ({
    icao24: "abc123",
    parts: [parts],
    revision,
    hasHistory: false,
  });
  const headAt = (cache: TrailRenderCache, track: TrailTrack, now: number) => {
    const layers = buildTrailLayers(
      layerParams({
        flights: [aircraft],
        trailMap: new Map([["abc123", track]]),
        cache,
        now,
      }),
    );
    const [head] = layerData(layers, "flight-trail-heads") as TrailHead[];
    return shapeBehindTail(head.path, aircraft);
  };
  const before = trackOf(samples, 1);
  const after = trackOf([...samples, harder], 2);
  const oldShape = headAt(createTrailRenderCache(), before, 0);
  const newShape = headAt(createTrailRenderCache(), after, 0);
  assert.ok(largestMove(oldShape, newShape) > 1, "the sample moves the join");

  const cache = createTrailRenderCache();
  headAt(cache, before, 0);
  // Drawn through the new head's points, the old shape is cut by chords a
  // few centimetres short.
  assert.ok(largestMove(headAt(cache, after, 1_000), oldShape) < HALF_PIXEL / 5);
  const halfway = headAt(cache, after, 1_125);
  assert.ok(largestMove(halfway, oldShape) > 0.1);
  assert.ok(largestMove(halfway, newShape) > 0.1);
  assert.ok(largestMove(headAt(cache, after, 1_250), newShape) < 0.01);
});

test("an easing join still starts where the trail now ends", () => {
  const from: TrailHead = {
    icao24: "abc123",
    path: [
      [-122.02, 37.5, 3_000],
      [-122.01, 37.501, 3_000],
      [-122, 37.5, 3_000],
    ],
    colors: [
      [10, 10, 10, 100],
      [10, 10, 10, 150],
      [10, 10, 10, 200],
    ],
  };
  const to: TrailHead = {
    icao24: "abc123",
    path: [
      [-122.015, 37.5, 3_000],
      [-122.008, 37.5, 3_000],
      [-122, 37.5, 3_000],
    ],
    colors: [
      [20, 20, 20, 120],
      [20, 20, 20, 160],
      [20, 20, 20, 200],
    ],
  };
  const eased = easeHead(from, to, 0);
  assert.deepEqual(eased.path[0], to.path[0]);
  assert.deepEqual(eased.colors[0], to.colors[0]);
  assert.deepEqual(eased.path.at(-1), to.path.at(-1));
  assert.notDeepEqual(eased.path[1], to.path[1]);
  assert.deepEqual(easeHead(from, to, 1), to);
});

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

test("trail lines smooth their edges, and no trail writes depth", () => {
  const layers = buildTrailLayers(layerParams());
  for (const id of ["flight-trails", "flight-trail-heads"]) {
    const line = layers.find((layer) => layer.props.id === id)!;
    assert.equal(line.props.antialiasing, true, id);
  }
  for (const layer of layers) {
    assert.equal(layer.props.parameters.depthWriteEnabled, false, layer.props.id);
  }
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

  // A straight line from where the trail ends, along it, into the tail.
  assert.deepEqual(head.path[0], LEAD.path[0]);
  assert.ok(head.path.every((vertex) => Math.abs(vertex[1] - 37.5) < 1e-9));
  for (let index = 1; index < head.path.length; index += 1) {
    assert.ok(head.path[index][0] > head.path[index - 1][0]);
  }
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

test("with traffic trails off, only the open or followed aircraft draws one", () => {
  const two = [
    flight({ longitude: eastbound(9).lng }),
    flight({ icao24: "def456", longitude: eastbound(9).lng }),
  ];
  const off = (overrides: Partial<TrailLayerParams>) =>
    layerData(
      buildTrailLayers(layerParams({ flights: two, allTraffic: false, ...overrides })),
      "flight-trails",
    );

  // Nothing open: the layers stay, with nothing in them.
  assert.equal(off({}).length, 0);
  assert.equal(off({ selectedIcao24: "def456" }).length, 1);
  assert.equal(off({ followIcao24: "abc123" }).length, 1);
  assert.equal(
    layerData(buildTrailLayers(layerParams({ flights: two })), "flight-trails").length,
    2,
  );
});

test("a followed aircraft above the height limit keeps its trail", () => {
  const high = [flight({ longitude: eastbound(9).lng, baroAltitude: 11_000 })];
  const drawn = (overrides: Partial<TrailLayerParams>) =>
    layerData(
      buildTrailLayers(layerParams({ flights: high, ceilingMeters: 6_000, ...overrides })),
      "flight-trails",
    ).length;
  assert.equal(drawn({}), 0);
  assert.equal(drawn({ followIcao24: "abc123" }), 1);
});

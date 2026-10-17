import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState, FlightTrack } from "@/lib/opensky";

import type { TrailSample } from "../types";
import {
  MAX_PART_GAP_MS,
  mergeHistoryAndLive,
  sampleFromFlight,
  smoothQuantizedAltitudes,
  splitIntoParts,
  trackToSamples,
} from "./trail-parts";

/** A sample `index` steps east of the origin, 5 s and about 1.1 km apart. */
function eastbound(
  index: number,
  overrides: Partial<TrailSample> = {},
): TrailSample {
  return {
    t: 1_000_000 + index * 5_000,
    lng: -122 + index * 0.0125,
    lat: 37.5,
    alt: 3_000,
    onGround: false,
    ...overrides,
  };
}

test("history is cut where the live samples begin, so the trail never folds back", () => {
  // History runs right up to the newest position; live began 10 samples ago.
  const history = Array.from({ length: 40 }, (_, index) => eastbound(index));
  const live = Array.from({ length: 10 }, (_, index) => eastbound(30 + index));

  const merged = mergeHistoryAndLive(history, live);

  assert.equal(merged.length, 40);
  for (let index = 1; index < merged.length; index += 1) {
    assert.ok(merged[index].t > merged[index - 1].t);
    assert.ok(merged[index].lng > merged[index - 1].lng);
  }
  assert.equal(merged[30], live[0]);
});

function waypoint(
  time: number,
  latitude: number | null,
  longitude: number,
  baroAltitude: number | null,
  onGround: boolean,
) {
  return { time, latitude, longitude, baroAltitude, trueTrack: 90, onGround };
}

test("provider tracks in Unix seconds become millisecond samples in time order", () => {
  const track: FlightTrack = {
    icao24: "abc123",
    startTime: 1_700_000_000,
    endTime: 1_700_000_060,
    callsign: null,
    path: [
      waypoint(1_700_000_060, 37.6, -122.3, 900, false),
      waypoint(1_700_000_000, 37.6, -122.4, null, true),
      waypoint(1_700_000_060, 37.6, -122.3, 900, false),
      waypoint(1_700_000_030, null, -122.35, 500, false),
    ],
  };

  assert.deepEqual(trackToSamples(track), [
    { t: 1_700_000_000_000, lng: -122.4, lat: 37.6, alt: 0, onGround: true },
    { t: 1_700_000_060_000, lng: -122.3, lat: 37.6, alt: 900, onGround: false },
  ]);
});

test("a long gap in reception starts a new part instead of a straight line across it", () => {
  const before = [eastbound(0), eastbound(1)];
  const after = [
    eastbound(2, { t: eastbound(1).t + MAX_PART_GAP_MS + 1 }),
    eastbound(3, { t: eastbound(1).t + MAX_PART_GAP_MS + 5_001 }),
  ];

  assert.deepEqual(splitIntoParts([...before, ...after]), [before, after]);
});

test("a jump no aircraft could fly starts a new part", () => {
  const samples = [
    eastbound(0),
    eastbound(1),
    eastbound(2, { lng: -110 }),
    eastbound(3, { lng: -109.99 }),
  ];

  assert.deepEqual(splitIntoParts(samples), [
    samples.slice(0, 2),
    samples.slice(2),
  ]);
});

test("a single bad position between two good ones is dropped", () => {
  const samples = [
    eastbound(0),
    eastbound(1),
    eastbound(2, { lat: 39 }),
    eastbound(3),
    eastbound(4),
  ];

  assert.deepEqual(splitIntoParts(samples), [
    [samples[0], samples[1], samples[3], samples[4]],
  ]);
});

test("ordinary flight stays in one part", () => {
  const samples = Array.from({ length: 20 }, (_, index) => eastbound(index));

  assert.deepEqual(splitIntoParts(samples), [samples]);
});

test("a position flung sideways off a straight line is dropped", () => {
  // Reachable in the time, but 3.3 km off a line its neighbours agree on.
  const samples = [
    eastbound(0),
    eastbound(1),
    eastbound(2, { lat: 37.53 }),
    eastbound(3),
    eastbound(4),
  ];

  assert.deepEqual(splitIntoParts(samples), [
    [samples[0], samples[1], samples[3], samples[4]],
  ]);
});

test("a tight U-turn keeps its apex", () => {
  const samples = [
    eastbound(0),
    eastbound(1),
    eastbound(2, { lat: 37.501 }),
    eastbound(1, { t: eastbound(3).t, lat: 37.502 }),
    eastbound(0, { t: eastbound(4).t, lat: 37.502 }),
  ];

  assert.deepEqual(splitIntoParts(samples), [samples]);
});

test("a sample after an unwatched turn starts a new part", () => {
  const samples = [
    eastbound(0),
    eastbound(1),
    eastbound(2, { afterGap: true }),
    eastbound(3),
  ];

  assert.deepEqual(splitIntoParts(samples), [
    samples.slice(0, 2),
    samples.slice(2),
  ]);
});

test("history fills a stretch the live samples missed", () => {
  const history = Array.from({ length: 40 }, (_, index) => eastbound(index));
  const live = [eastbound(10), eastbound(11), eastbound(30, { afterGap: true })];

  const merged = mergeHistoryAndLive(history, live);

  assert.equal(merged.length, 31);
  assert.deepEqual(
    merged.map((sample) => sample.t),
    history.slice(0, 31).map((sample) => sample.t),
  );
  assert.ok(!merged.at(-1)!.afterGap);
  assert.equal(splitIntoParts(merged).length, 1);
});

test("a live gap history does not cover stays a gap", () => {
  const history = Array.from({ length: 5 }, (_, index) => eastbound(index));
  const live = [eastbound(10), eastbound(11), eastbound(30, { afterGap: true })];

  assert.equal(mergeHistoryAndLive(history, live).at(-1)!.afterGap, true);
});

test("positions off the globe are not samples", () => {
  const track: FlightTrack = {
    icao24: "abc123",
    startTime: 1_700_000_000,
    endTime: 1_700_000_010,
    callsign: null,
    path: [
      waypoint(1_700_000_000, 91, -122, 3_000, false),
      waypoint(1_700_000_005, 37.5, 200, 3_000, false),
      waypoint(1_700_000_010, 37.5, -122, 3_000, false),
    ],
  };

  assert.deepEqual(
    trackToSamples(track).map((sample) => sample.t),
    [1_700_000_010_000],
  );
  assert.equal(
    sampleFromFlight({
      longitude: -122,
      latitude: -95,
      baroAltitude: 3_000,
      onGround: false,
      provenance: { observationTime: 1 },
    } as FlightState),
    null,
  );
});

test("of two track points at one moment, the one with a height is kept", () => {
  const track: FlightTrack = {
    icao24: "abc123",
    startTime: 1_700_000_000,
    endTime: 1_700_000_000,
    callsign: null,
    path: [
      waypoint(1_700_000_000, 37.5, -122, null, false),
      waypoint(1_700_000_000, 37.5, -122, 3_000, false),
    ],
  };

  assert.deepEqual(
    trackToSamples(track).map((sample) => sample.alt),
    [3_000],
  );
});

test("a sample after an unwatched stretch is never dropped as a spike", () => {
  // Off to the side, but it starts a new stretch, so its break must stay.
  const samples = [
    eastbound(0),
    eastbound(1),
    eastbound(2, { lat: 37.53, afterGap: true }),
    eastbound(3),
  ];

  assert.deepEqual(splitIntoParts(samples), [
    samples.slice(0, 2),
    samples.slice(2),
  ]);
});

const FT = 0.3048;

/** Samples a minute apart at the given altitudes in feet. */
function atFeet(feet: number[], start = 0): TrailSample[] {
  return feet.map((altitude, index) =>
    eastbound(start + index, {
      t: 1_000_000 + (start + index) * 60_000,
      alt: altitude * FT,
    }),
  );
}

test("a descent rounded down to whole thousands of feet becomes smooth", () => {
  // OpenSky's track readings while descending through 6,000-1,000 ft.
  const rounded = atFeet([6000, 6000, 5000, 4000, 4000, 3000, 2000, 1000, 1000]);
  const smooth = smoothQuantizedAltitudes(rounded).map((sample) => sample.alt! / FT);

  // It falls the whole way, with no flat treads left between the steps...
  for (let index = 1; index < smooth.length; index += 1) {
    assert.ok(smooth[index] < smooth[index - 1], `falling at ${index}`);
  }
  // ...and each height stays inside the band its rounded reading allows.
  rounded.forEach((sample, index) => {
    const reading = sample.alt! / FT;
    assert.ok(smooth[index] >= reading - 1e-6 && smooth[index] <= reading + 1000);
  });
});

test("a level run of rounded readings sits mid-band, and the ground stays at 0", () => {
  const level = atFeet([1000, 1000, 1000, 1000, 1000]);
  level.push(eastbound(9, { t: 1_000_000 + 9 * 60_000, alt: 0, onGround: true }));

  const smooth = smoothQuantizedAltitudes(level);
  for (const sample of smooth.slice(0, 5)) {
    assert.ok(Math.abs(sample.alt! / FT - 1500) < 1);
  }
  assert.equal(smooth[5].alt, 0);
});

test("finer altitudes are not taken for rounded ones", () => {
  const fine = atFeet([6025, 5950, 5875, 5800, 5725, 5650]);

  assert.equal(smoothQuantizedAltitudes(fine), fine);
});

test("history meets the live trail at the live height, easing in over two minutes", () => {
  // History rounded to 1,000 ft; live says 1,800 ft at the hand-over.
  const history = atFeet([1000, 1000, 1000, 1000]).map((sample, index) => ({
    ...sample,
    t: 1_000_000 + index * 30_000,
  }));
  const live = [
    eastbound(5, { t: 1_000_000 + 4 * 30_000, alt: 1800 * FT }),
    eastbound(6, { t: 1_000_000 + 5 * 30_000, alt: 1800 * FT }),
  ];

  const merged = mergeHistoryAndLive(history, live);
  const feet = merged.map((sample) => Math.round(sample.alt! / FT));

  // The last history sample is at the live height; earlier ones ease up to it.
  assert.equal(feet[3], 1800);
  assert.ok(feet[2] > 1000 && feet[2] < 1800);
  assert.ok(feet[0] >= 1000 && feet[0] < feet[1]);
  assert.deepEqual(feet.slice(4), [1800, 1800]);
});

test("history older than two minutes before the hand-over keeps its height", () => {
  const history = atFeet([1000, 1000, 1000, 1000]);
  const live = [eastbound(5, { t: 1_000_000 + 4 * 60_000, alt: 1800 * FT })];

  const merged = mergeHistoryAndLive(history, live);
  assert.ok(Math.abs(merged[0].alt! / FT - 1000) < 1);
  assert.ok(Math.abs(merged[3].alt! / FT - 1800) < 1);
});

test("history filling a live gap meets the live trail at both ends", () => {
  const history = Array.from({ length: 6 }, (_, index) =>
    eastbound(index + 1, {
      t: 1_000_000 + (index + 1) * 20_000,
      alt: 3000 * FT,
    }),
  );
  const live = [
    eastbound(0, { t: 1_000_000, alt: 3200 * FT }),
    eastbound(8, { t: 1_000_000 + 8 * 20_000, alt: 2800 * FT, afterGap: true }),
  ];

  const merged = mergeHistoryAndLive(history, live);
  const feet = merged.map((sample) => Math.round(sample.alt! / FT));

  assert.equal(merged.length, 8);
  assert.equal(feet[1], 3200);
  assert.equal(feet[6], 2800);
});

import assert from "node:assert/strict";
import test from "node:test";

import { altitudeToColor } from "@/lib/flight-utils";
import type { TrailSample, TrailTrack } from "@/lib/trails/types";

import { aircraftColor } from "./aircraft-appearance";
import { aircraftElevationMeters } from "./altitude-projection";
import {
  getTrailGeometry,
  TRAIL_ALPHA,
  type TrailGeometryOptions,
} from "./trail-geometry";

const OPTIONS: TrailGeometryOptions = {
  windowMs: null,
  altitudeDisplayMode: "realistic",
  altColors: true,
  defaultColor: [180, 220, 255, 200],
  appearance: { category: null },
};

let revision = 0;
function track(parts: TrailSample[][]): TrailTrack {
  revision += 1;
  return { icao24: "abc123", parts, revision, hasHistory: false };
}

/** A sample on a steady right-hand turn: 5 s and about 1.1 km apart. */
function turning(index: number, alt = 3_000): TrailSample {
  const angle = index * 0.12;
  return {
    t: 1_000_000 + index * 5_000,
    lng: -122 + Math.sin(angle) * 0.12,
    lat: 37.5 + Math.cos(angle) * 0.1,
    alt,
    onGround: false,
  };
}

function eastbound(index: number): TrailSample {
  return {
    t: 1_000_000 + index * 5_000,
    lng: -122 + index * 0.0125,
    lat: 37.5,
    alt: 3_000,
    onGround: false,
  };
}

test("a new sample leaves every earlier vertex of the trail where it was", () => {
  const samples = Array.from({ length: 12 }, (_, index) => turning(index));
  const before = getTrailGeometry(
    new Map(),
    track([samples.slice(0, 11)]),
    OPTIONS,
  );
  const after = getTrailGeometry(new Map(), track([samples]), OPTIONS);

  const oldPath = before.bodies[0].path;
  assert.deepEqual(after.bodies[0].path.slice(0, oldPath.length), oldPath);
  assert.ok(after.bodies[0].path.length > oldPath.length);
});

test("the newest 20 s are left to the head, which runs to the second-newest sample", () => {
  const samples = Array.from({ length: 10 }, (_, index) => turning(index));
  const geometry = getTrailGeometry(new Map(), track([samples]), OPTIONS);
  const lead = geometry.lead!;

  const end = geometry.bodies[0].path.at(-1)!;
  assert.deepEqual(end.slice(0, 2), [samples[4].lng, samples[4].lat]);
  assert.deepEqual(lead.path[0], end);
  assert.deepEqual(lead.path.at(-1)!.slice(0, 2), [samples[8].lng, samples[8].lat]);
  assert.equal(lead.path.length, lead.tangents.length);
  assert.ok(lead.tangents.every((tangent) => tangent !== null));
});

test("straight flight is drawn through the samples alone, and turns are curved", () => {
  const straight = getTrailGeometry(
    new Map(),
    track([Array.from({ length: 10 }, (_, index) => eastbound(index))]),
    OPTIONS,
  );
  const turn = getTrailGeometry(
    new Map(),
    track([Array.from({ length: 10 }, (_, index) => turning(index))]),
    OPTIONS,
  );

  assert.equal(straight.bodies[0].path.length, 5);
  assert.ok(turn.bodies[0].path.length > 5);
});

test("separate parts stay separate lines", () => {
  const geometry = getTrailGeometry(
    new Map(),
    track([
      [eastbound(0), eastbound(1), eastbound(2)],
      [eastbound(80), eastbound(81), eastbound(82)],
    ]),
    OPTIONS,
  );

  // The newer part is short enough to be all lead.
  assert.equal(geometry.bodies.length, 1);
  assert.equal(geometry.bodies[0].path.at(-1)![0], eastbound(2).lng);
  assert.equal(geometry.lead?.path[0][0], eastbound(80).lng);
});

test("colors follow the aircraft altitude palette and fade toward the oldest end", () => {
  const samples = Array.from({ length: 40 }, (_, index) =>
    turning(index, 1_000 + index * 100),
  );
  const geometry = getTrailGeometry(new Map(), track([samples]), {
    ...OPTIONS,
    windowMs: 120_000,
  });
  const { path, colors } = geometry.bodies[0];

  // The two-minute window starts 120 s before the newest sample.
  assert.equal(path.length > 0, true);
  assert.equal(colors[0][3], 0);
  assert.equal(colors.at(-1)![3], TRAIL_ALPHA);
  for (let index = 1; index < colors.length; index += 1) {
    assert.ok(colors[index][3] >= colors[index - 1][3]);
  }

  assert.deepEqual(
    colors.at(-1)!.slice(0, 3),
    altitudeToColor(samples[34].alt).slice(0, 3),
  );
  assert.deepEqual(
    geometry.lead?.colors.at(-1)!.slice(0, 3),
    altitudeToColor(samples[38].alt).slice(0, 3),
  );
});

test("a trail takes on its aircraft's tint", () => {
  const samples = Array.from({ length: 10 }, (_, index) => eastbound(index));
  const appearance = { category: 2 };
  const geometry = getTrailGeometry(new Map(), track([samples]), {
    ...OPTIONS,
    appearance,
  });

  const expected = aircraftColor(altitudeToColor(3_000), appearance);
  assert.deepEqual(geometry.bodies[0].colors.at(-1)!.slice(0, 3), expected.slice(0, 3));
  assert.deepEqual(geometry.lead?.colors.at(-1)!.slice(0, 3), expected.slice(0, 3));
});

test("a trail rides at its aircraft's drawn height", () => {
  const samples = Array.from({ length: 10 }, (_, index) => eastbound(index));
  const geometry = getTrailGeometry(new Map(), track([samples]), {
    ...OPTIONS,
    altitudeDisplayMode: "presentation",
  });

  const aircraft = aircraftElevationMeters(3_000, "presentation");
  for (const [, , z] of [...geometry.bodies[0].path, ...geometry.lead!.path]) {
    assert.ok(Math.abs(aircraft - z) < 1e-6);
  }
});

test("the time window cuts the trail exactly at its oldest visible moment", () => {
  const samples = Array.from({ length: 30 }, (_, index) => eastbound(index));
  const geometry = getTrailGeometry(new Map(), track([samples]), {
    ...OPTIONS,
    windowMs: 60_000,
  });

  // Newest sample is index 29; one minute earlier is index 17.
  assert.ok(Math.abs(geometry.bodies[0].path[0][0] - samples[17].lng) < 1e-9);
});

test("a lone altitude glitch does not spike the trail", () => {
  const samples = Array.from({ length: 10 }, (_, index) => eastbound(index));
  samples[2] = { ...samples[2], alt: 0 };
  const geometry = getTrailGeometry(new Map(), track([samples]), OPTIONS);

  for (const [, , z] of geometry.bodies[0].path) {
    assert.ok(z > 2_900);
  }
});

test("geometry is reused until the track, altitude mode, or colours change", () => {
  const cache = new Map();
  const steady = track([
    Array.from({ length: 6 }, (_, index) => turning(index)),
  ]);

  const first = getTrailGeometry(cache, steady, OPTIONS);
  assert.equal(getTrailGeometry(cache, steady, OPTIONS), first);
  const presentation = { ...OPTIONS, altitudeDisplayMode: "presentation" as const };
  assert.notEqual(getTrailGeometry(cache, steady, presentation), first);
  assert.notEqual(
    getTrailGeometry(cache, steady, { ...presentation, appearance: { category: 2 } }),
    getTrailGeometry(cache, steady, presentation),
  );
});

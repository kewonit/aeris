import assert from "node:assert/strict";
import test from "node:test";

import type { TrailEntry } from "@/hooks/use-trail-history";
import type { FlightState } from "@/lib/opensky";
import { altitudeToColor as aircraftAltitudeToColor } from "@/lib/flight-utils";

import {
  buildConnectorGradientColors,
  buildTrailLayers,
  trailAltitudeToColor,
} from "./flight-layer-builders.ts";

const DEFAULT_COLOR: [number, number, number, number] = [255, 255, 255, 255];

function makeTrail(): TrailEntry {
  return {
    icao24: "abc123",
    path: [
      [8.0, 50.0],
      [8.05, 50.0],
      [8.1, 50.0],
    ],
    altitudes: [1000, 1020, 1040],
    timestamps: [1, 2, 3],
    baroAltitude: 1040,
  };
}

function makeArcTrail(count: number, fullHistory = false): TrailEntry {
  const centerLng = 8.0;
  const centerLat = 50.0;
  const radius = 0.08;
  const start = -Math.PI / 2;
  const end = 0;
  const totalSamples = 24;
  const path: [number, number][] = [];
  const altitudes: number[] = [];
  const timestamps: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const t = totalSamples === 1 ? 0 : index / (totalSamples - 1);
    const angle = start + (end - start) * t;
    path.push([
      centerLng + Math.cos(angle) * radius,
      centerLat + Math.sin(angle) * radius,
    ]);
    altitudes.push(10_000 + index * 20);
    timestamps.push(index);
  }

  return {
    icao24: fullHistory ? "hist01" : "arc01",
    path,
    altitudes,
    timestamps,
    baroAltitude: altitudes[altitudes.length - 1],
    fullHistory,
  };
}

function makeFlight(): FlightState {
  return {
    icao24: "abc123",
    longitude: 8.1,
    latitude: 50.0,
    baroAltitude: 1040,
    trueTrack: 90,
    velocity: 220,
    onGround: false,
  } as FlightState;
}

test("trail body colors are rebuilt instead of trusting stale persistent color cache entries", () => {
  const trail = makeTrail();
  const flight = makeFlight();
  const trailColorCache = new Map<
    string,
    { key: string; result: [number, number, number, number][] }
  >();

  trailColorCache.set(trail.icao24, {
    key: "stale-color-cache-entry",
    result: [[255, 80, 80, 255]],
  });

  const layers = buildTrailLayers({
    interpolated: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    currentTrails: [trail],
    trailMap: new Map([[trail.icao24, trail]]),
    trailDistance: 80,
    trailThickness: 2,
    altColors: true,
    altitudeDisplayMode: "presentation",
    defaultColor: DEFAULT_COLOR,
    elapsed: 0,
    visualFrame: 0,
    globeFade: 1,
    currentZoom: 9,
    elevScale: 1,
    trailBasePathCache: new Map(),
    trailPathCache: new Map(),
    trailColorCache,
    handledIdsSet: new Set(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set(),
  });

  const trailBodyLayer = layers[0] as unknown as {
    props: {
      data: Array<{
        path: [number, number, number][];
        color: [number, number, number, number];
      }>;
    };
  };

  assert.ok(trailBodyLayer.props.data.length > 0);
  assert.ok(
    trailBodyLayer.props.data.every((segment) => segment.path.length === 2),
  );
  assert.ok(
    trailBodyLayer.props.data.every(
      (segment) =>
        segment.color[0] !== 255 ||
        segment.color[1] !== 80 ||
        segment.color[2] !== 80 ||
        segment.color[3] !== 255,
    ),
  );
});

test("buildTrailLayers emits explicit drawable body segments", () => {
  const trail = makeTrail();
  const flight = makeFlight();

  const layers = buildTrailLayers({
    interpolated: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    currentTrails: [trail],
    trailMap: new Map([[trail.icao24, trail]]),
    trailDistance: 80,
    trailThickness: 2,
    altColors: true,
    altitudeDisplayMode: "presentation",
    defaultColor: DEFAULT_COLOR,
    elapsed: 0,
    visualFrame: 0,
    globeFade: 1,
    currentZoom: 9,
    elevScale: 1,
    trailBasePathCache: new Map(),
    trailPathCache: new Map(),
    trailColorCache: new Map(),
    handledIdsSet: new Set(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set(),
  });

  const trailBodyLayer = layers[0] as unknown as {
    props: {
      data: Array<{
        path: [number, number, number][];
        color: [number, number, number, number];
      }>;
    };
  };

  assert.ok(trailBodyLayer.props.data.length > 0);
  assert.ok(
    trailBodyLayer.props.data.every((segment) => segment.path.length === 2),
  );
  assert.ok(
    trailBodyLayer.props.data.every((segment) => segment.color[3] >= 55),
  );
});

test("connector gradient starts at the trail tail alpha and softens toward the aircraft", () => {
  const colors = buildConnectorGradientColors(
    [
      [8.0, 50.0, 1000],
      [8.01, 50.0, 1100],
      [8.02, 50.0, 1200],
    ],
    true,
    DEFAULT_COLOR,
  );

  assert.equal(colors[0][3], 220);
  assert.ok(colors[colors.length - 1][3] < colors[0][3]);
});

test("connector gradient cross-fades the trail color even when altitude stays constant", () => {
  const colors = buildConnectorGradientColors(
    [
      [8.0, 50.0, 1000],
      [8.01, 50.0, 1000],
      [8.02, 50.0, 1000],
    ],
    true,
    DEFAULT_COLOR,
  );

  assert.notDeepEqual(
    colors[0].slice(0, 3),
    colors[colors.length - 1].slice(0, 3),
  );
});

test("trail altitude colors use the same altitude palette as aircraft colors", () => {
  const low = trailAltitudeToColor(0);
  const mid = trailAltitudeToColor(6500);
  const high = trailAltitudeToColor(13000);

  assert.deepStrictEqual(low, aircraftAltitudeToColor(0));
  assert.deepStrictEqual(mid, aircraftAltitudeToColor(6500));
  assert.deepStrictEqual(high, aircraftAltitudeToColor(13000));
});

test("buildTrailLayers keeps all but the last few live-turn segments fixed across a live append", () => {
  const firstTrail = makeArcTrail(12);
  const secondTrail = makeArcTrail(13);
  const flight = {
    ...makeFlight(),
    icao24: firstTrail.icao24,
    longitude: secondTrail.path[secondTrail.path.length - 1][0],
    latitude: secondTrail.path[secondTrail.path.length - 1][1],
    baroAltitude: secondTrail.altitudes[secondTrail.altitudes.length - 1],
  } as FlightState;

  const trailBasePathCache = new Map<
    string,
    { key: string; basePath: [number, number, number][] }
  >();

  const common = {
    interpolated: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    trailDistance: 80,
    trailThickness: 2,
    altColors: true,
    altitudeDisplayMode: "presentation" as const,
    defaultColor: DEFAULT_COLOR,
    elapsed: 0,
    visualFrame: 0,
    globeFade: 1,
    currentZoom: 9,
    elevScale: 1,
    trailBasePathCache,
    trailPathCache: new Map(),
    trailColorCache: new Map(),
    handledIdsSet: new Set(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set(),
  };

  const firstLayers = buildTrailLayers({
    ...common,
    currentTrails: [firstTrail],
    trailMap: new Map([[firstTrail.icao24, firstTrail]]),
  });
  const secondLayers = buildTrailLayers({
    ...common,
    currentTrails: [secondTrail],
    trailMap: new Map([[secondTrail.icao24, secondTrail]]),
  });

  const firstData = (
    firstLayers[0] as unknown as {
      props: { data: Array<{ path: [number, number, number][] }> };
    }
  ).props.data;
  const secondData = (
    secondLayers[0] as unknown as {
      props: { data: Array<{ path: [number, number, number][] }> };
    }
  ).props.data;

  const stableCount = Math.floor(firstData.length * 0.5);
  assert.deepStrictEqual(
    secondData.slice(0, stableCount).map((segment) => segment.path),
    firstData.slice(0, stableCount).map((segment) => segment.path),
  );
});

test("buildTrailLayers keeps the earlier selected-history turn fixed while the live tail extends", () => {
  const firstTrail = makeArcTrail(14, true);
  const secondTrail = makeArcTrail(15, true);
  const flight = {
    ...makeFlight(),
    icao24: firstTrail.icao24,
    longitude: secondTrail.path[secondTrail.path.length - 1][0],
    latitude: secondTrail.path[secondTrail.path.length - 1][1],
    baroAltitude: secondTrail.altitudes[secondTrail.altitudes.length - 1],
  } as FlightState;

  const common = {
    interpolated: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    trailDistance: 80,
    trailThickness: 2,
    altColors: true,
    altitudeDisplayMode: "presentation" as const,
    defaultColor: DEFAULT_COLOR,
    elapsed: 0,
    visualFrame: 0,
    globeFade: 1,
    currentZoom: 9,
    elevScale: 1,
    trailBasePathCache: new Map(),
    trailPathCache: new Map(),
    trailColorCache: new Map(),
    handledIdsSet: new Set(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set(),
  };

  const firstLayers = buildTrailLayers({
    ...common,
    currentTrails: [firstTrail],
    trailMap: new Map([[firstTrail.icao24, firstTrail]]),
  });
  const secondLayers = buildTrailLayers({
    ...common,
    currentTrails: [secondTrail],
    trailMap: new Map([[secondTrail.icao24, secondTrail]]),
  });

  const firstData = (
    firstLayers[0] as unknown as {
      props: { data: Array<{ path: [number, number, number][] }> };
    }
  ).props.data;
  const secondData = (
    secondLayers[0] as unknown as {
      props: { data: Array<{ path: [number, number, number][] }> };
    }
  ).props.data;

  const stableCount = Math.max(0, firstData.length - 20);
  assert.deepStrictEqual(
    secondData.slice(0, stableCount).map((segment) => segment.path),
    firstData.slice(0, stableCount).map((segment) => segment.path),
  );
});

test("buildTrailLayers clips live trail overshoot so the rendered body stays behind the aircraft", () => {
  const trail: TrailEntry = {
    icao24: "overshoot01",
    path: [
      [8.0, 50.0],
      [8.08, 50.0],
      [8.1005, 50.0],
    ],
    altitudes: [1000, 1010, 1020],
    timestamps: [1, 2, 3],
    baroAltitude: 1020,
  };

  const flight = {
    ...makeFlight(),
    icao24: trail.icao24,
    longitude: 8.1,
    latitude: 50.0,
    baroAltitude: 1020,
  } as FlightState;

  const layers = buildTrailLayers({
    interpolated: [flight],
    interpolatedMap: new Map([[flight.icao24, flight]]),
    currentTrails: [trail],
    trailMap: new Map([[trail.icao24, trail]]),
    trailDistance: 80,
    trailThickness: 2,
    altColors: true,
    altitudeDisplayMode: "presentation",
    defaultColor: DEFAULT_COLOR,
    elapsed: 0,
    visualFrame: 0,
    globeFade: 1,
    currentZoom: 9,
    elevScale: 1,
    trailBasePathCache: new Map(),
    trailPathCache: new Map(),
    trailColorCache: new Map(),
    handledIdsSet: new Set(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set(),
  });

  const trailBodyLayer = layers[0] as unknown as {
    props: {
      data: Array<{ path: [number, number, number][] }>;
    };
  };

  const maxBodyLongitude = Math.max(
    ...trailBodyLayer.props.data.flatMap((segment) =>
      segment.path.map((point) => point[0]),
    ),
  );

  assert.ok(maxBodyLongitude < flight.longitude!);
});

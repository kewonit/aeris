import assert from "node:assert/strict";
import test from "node:test";

import type { TrailEntry } from "@/hooks/use-trail-history";
import type { FlightState } from "@/lib/opensky";
import type {
  TrailEnvelope,
  TrailSegment,
  TrailSnapshot,
} from "@/lib/trails/types";
import { altitudeToColor as aircraftAltitudeToColor } from "@/lib/flight-utils";

import {
  buildConnectorGradientColors,
  buildTrailLayers,
  trailAltitudeToColor,
} from "./flight-layer-builders";

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
    const t = index / (totalSamples - 1);
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

function makeRecentArcSamples(): TrailSnapshot[] {
  const centerLng = 8.0;
  const centerLat = 50.0;
  const radius = 0.08;
  const start = -Math.PI / 2;
  const end = 0;

  return Array.from({ length: 18 }, (_, index) => {
    const t = index / 17;
    const angle = start + (end - start) * t;

    return {
      source: "live",
      timestamp: 1_000 + index,
      lng: centerLng + Math.cos(angle) * radius,
      lat: centerLat + Math.sin(angle) * radius,
      altitude: 10_000 + index * 20,
      track: 90,
      groundSpeed: 220,
      quality: "authoritative-live",
      onGround: false,
    } satisfies TrailSnapshot;
  });
}

function makeHistoryPrefix(join: TrailSnapshot): TrailSegment {
  const startLng = 7.2;
  const startLat = 49.2;
  const samples = Array.from({ length: 140 }, (_, index) => {
    const t = index / 139;

    return {
      source: "adsb-fi",
      timestamp: index,
      lng: startLng + (join.lng - startLng) * t,
      lat: startLat + (join.lat - startLat) * t,
      altitude: 9_500 + index * 2,
      track: 45,
      groundSpeed: 220,
      quality: "authoritative-trace",
      onGround: false,
    } satisfies TrailSnapshot;
  });

  return {
    kind: "historical",
    provider: "adsb-fi",
    samples,
  };
}

function makeSelectedEnvelope(liveTail: TrailSnapshot[]): TrailEnvelope {
  return {
    icao24: "hist01",
    provider: "adsb-fi",
    outcome: "full-history",
    selectionGeneration: 1,
    liveRevision: 1,
    historyRevision: 1,
    lastSeenAt: 1,
    liveTail,
    historySegments: [makeHistoryPrefix(liveTail[0])],
    entry: null,
  };
}

function makeFlattenedSelectedTrail(envelope: TrailEnvelope): TrailEntry {
  const samples = [
    ...envelope.historySegments.flatMap((segment) => segment.samples),
    ...envelope.liveTail,
  ];

  return {
    icao24: envelope.icao24,
    path: samples.map((sample) => [sample.lng, sample.lat]),
    altitudes: samples.map((sample) => sample.altitude),
    timestamps: samples.map((sample) => sample.timestamp),
    baroAltitude: samples[samples.length - 1]?.altitude ?? null,
    fullHistory: true,
  };
}

function reconstructPolyline(
  segments: Array<{ path: [number, number, number][] }>,
) {
  const points: [number, number, number][] = [];

  for (const segment of segments) {
    for (const point of segment.path) {
      const last = points[points.length - 1];
      if (
        last &&
        last[0] === point[0] &&
        last[1] === point[1] &&
        last[2] === point[2]
      ) {
        continue;
      }
      points.push(point);
    }
  }

  return points;
}

function samplePoint(points: [number, number, number][], t: number) {
  if (points.length === 0) {
    return [0, 0, 0] as const;
  }

  const scaled = t * (points.length - 1);
  const start = Math.floor(scaled);
  const end = Math.min(points.length - 1, start + 1);
  const fraction = scaled - start;
  const a = points[start];
  const b = points[end];

  return [
    a[0] + (b[0] - a[0]) * fraction,
    a[1] + (b[1] - a[1]) * fraction,
    a[2] + (b[2] - a[2]) * fraction,
  ] as const;
}

function maxPlanarDelta(
  left: [number, number, number][],
  right: [number, number, number][],
): number {
  let maxDelta = 0;

  for (let step = 0; step <= 100; step += 1) {
    const t = step / 100;
    const a = samplePoint(left, t);
    const b = samplePoint(right, t);
    maxDelta = Math.max(maxDelta, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }

  return maxDelta;
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
    handledIdsSet: new Set<string>(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set<string>(),
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
    handledIdsSet: new Set<string>(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set<string>(),
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
    handledIdsSet: new Set<string>(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set<string>(),
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
    handledIdsSet: new Set<string>(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set<string>(),
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
    handledIdsSet: new Set<string>(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set<string>(),
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

test("buildTrailLayers omits a connector when the trail tail is implausibly far behind the aircraft", () => {
  const aircraft = {
    icao24: "gap01",
    longitude: 73.6,
    latitude: 19.8,
    baroAltitude: 18_000,
    trueTrack: 70,
    velocity: 240,
  } as FlightState;

  const trail: TrailEntry = {
    icao24: "gap01",
    path: [
      [72.88, 19.08],
      [72.9, 19.09],
      [72.92, 19.1],
    ],
    altitudes: [17_200, 17_350, 17_500],
    timestamps: [1_000, 11_000, 21_000],
    baroAltitude: 17_500,
  };

  const layers = buildTrailLayers({
    interpolated: [aircraft],
    interpolatedMap: new Map([[aircraft.icao24, aircraft]]),
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
    handledIdsSet: new Set<string>(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set<string>(),
  });

  const connectorSegments = (
    layers[1] as unknown as {
      props: { data: Array<{ path: [number, number, number][] }> };
    }
  ).props.data;

  assert.equal(connectorSegments.length, 0);
});

test("buildTrailLayers uses segmented selected geometry for the selected aircraft overlap body", () => {
  const liveTail = makeRecentArcSamples();
  const activeTrail: TrailEntry = {
    icao24: "hist01",
    path: liveTail.map((sample) => [sample.lng, sample.lat]),
    altitudes: liveTail.map((sample) => sample.altitude),
    timestamps: liveTail.map((sample) => sample.timestamp),
    baroAltitude: liveTail[liveTail.length - 1].altitude,
  };
  const selectedEnvelope = makeSelectedEnvelope(liveTail);
  const selectedTrail = makeFlattenedSelectedTrail(selectedEnvelope);
  const flight = {
    ...makeFlight(),
    icao24: activeTrail.icao24,
    longitude: liveTail[liveTail.length - 1].lng,
    latitude: liveTail[liveTail.length - 1].lat,
    baroAltitude: liveTail[liveTail.length - 1].altitude,
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
    handledIdsSet: new Set<string>(),
    visibleTrailCacheMap: new Map(),
    activeIcaosSet: new Set<string>(),
  };

  const activeLayers = buildTrailLayers({
    ...common,
    currentTrails: [activeTrail],
    trailMap: new Map([[activeTrail.icao24, activeTrail]]),
  });
  const selectedLayers = buildTrailLayers({
    ...common,
    currentTrails: [selectedTrail],
    trailMap: new Map([[selectedTrail.icao24, selectedTrail]]),
    selectedIcao24: selectedTrail.icao24,
    selectedEnvelope,
  });

  const activeBodySegments = (
    activeLayers[0] as unknown as {
      props: { data: Array<{ path: [number, number, number][] }> };
    }
  ).props.data;
  const selectedBodySegments = (
    selectedLayers[0] as unknown as {
      props: { data: Array<{ path: [number, number, number][] }> };
    }
  ).props.data;

  const activeBody = reconstructPolyline(activeBodySegments);
  const selectedBody = reconstructPolyline(selectedBodySegments);
  const selectedRecentBody = selectedBody.slice(-activeBody.length);

  assert.ok(activeBody.length > 10);
  assert.equal(selectedRecentBody.length, activeBody.length);
  assert.ok(maxPlanarDelta(activeBody, selectedRecentBody) < 1e-6);
});

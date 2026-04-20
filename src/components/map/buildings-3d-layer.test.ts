import assert from "node:assert/strict";
import test from "node:test";

import {
  __internals,
  addBuildings3DLayer,
  BUILDINGS_3D_LAYER_ID,
  BUILDINGS_3D_MIN_ZOOM,
  BUILDINGS_3D_SOURCE_LAYER,
  findVectorSource,
  setBuildings3DTheme,
} from "./buildings-3d-layer";

// ─── Minimal MapLibre stub ─────────────────────────────────────────────────
// We test at the spec/API boundary. A thin stub mirrors the subset of the
// maplibre-gl Map surface this module touches. No real WebGL needed.

type StubLayer = {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  minzoom?: number;
  filter?: unknown;
  paint?: Record<string, unknown>;
};

type StubStyle = {
  sources: Record<string, { type: string }>;
  layers: StubLayer[];
};

function makeStubMap(style: StubStyle) {
  const paintChanges: Array<{
    layer: string;
    prop: string;
    value: unknown;
  }> = [];
  const addLayerCalls: Array<{
    spec: StubLayer;
    beforeId: string | undefined;
  }> = [];

  const map = {
    getStyle: () => style,
    getLayer: (id: string) => style.layers.find((l) => l.id === id),
    addLayer: (spec: StubLayer, beforeId?: string) => {
      addLayerCalls.push({ spec, beforeId });
      if (beforeId) {
        const idx = style.layers.findIndex((l) => l.id === beforeId);
        if (idx >= 0) {
          style.layers.splice(idx, 0, spec);
          return;
        }
      }
      style.layers.push(spec);
    },
    setPaintProperty: (layer: string, prop: string, value: unknown) => {
      paintChanges.push({ layer, prop, value });
    },
  };

  return { map, paintChanges, addLayerCalls };
}

function freshStyle(): StubStyle {
  return {
    sources: {
      openmaptiles: { type: "vector" },
      satellite: { type: "raster" },
    },
    layers: [
      { id: "background", type: "background" },
      { id: "water", type: "fill" },
      { id: "country-label", type: "symbol" },
    ],
  };
}

// ─── findVectorSource ──────────────────────────────────────────────────────

test("findVectorSource returns the first vector source", () => {
  const { map } = makeStubMap(freshStyle());
  assert.equal(findVectorSource(map as never), "openmaptiles");
});

test("findVectorSource returns null when no vector source exists", () => {
  const { map } = makeStubMap({
    sources: { satellite: { type: "raster" } },
    layers: [],
  });
  assert.equal(findVectorSource(map as never), null);
});

test("findVectorSource returns null when style has no sources", () => {
  const map = { getStyle: () => null } as never;
  assert.equal(findVectorSource(map), null);
});

// ─── addBuildings3DLayer ───────────────────────────────────────────────────

test("addBuildings3DLayer adds a fill-extrusion layer with correct spec", () => {
  const { map, addLayerCalls } = makeStubMap(freshStyle());
  addBuildings3DLayer(map as never, { dark: true });

  assert.equal(addLayerCalls.length, 1);
  const { spec, beforeId } = addLayerCalls[0];
  assert.equal(spec.id, BUILDINGS_3D_LAYER_ID);
  assert.equal(spec.type, "fill-extrusion");
  assert.equal(spec.source, "openmaptiles");
  assert.equal(spec["source-layer"], BUILDINGS_3D_SOURCE_LAYER);
  assert.equal(spec.minzoom, BUILDINGS_3D_MIN_ZOOM);
  // Inserted before the first symbol layer so labels stay on top.
  assert.equal(beforeId, "country-label");
});

test("addBuildings3DLayer is idempotent on repeated calls", () => {
  const { map, addLayerCalls } = makeStubMap(freshStyle());
  addBuildings3DLayer(map as never, { dark: true });
  addBuildings3DLayer(map as never, { dark: true });
  addBuildings3DLayer(map as never, { dark: false });
  assert.equal(addLayerCalls.length, 1);
});

test("addBuildings3DLayer is a no-op without a vector source", () => {
  const { map, addLayerCalls } = makeStubMap({
    sources: { satellite: { type: "raster" } },
    layers: [],
  });
  addBuildings3DLayer(map as never, { dark: true });
  assert.equal(addLayerCalls.length, 0);
});

test("addBuildings3DLayer swallows addLayer failures (e.g. missing source-layer)", () => {
  const style = freshStyle();
  const map = {
    getStyle: () => style,
    getLayer: () => undefined,
    addLayer: () => {
      throw new Error("Source layer 'building' does not exist");
    },
    setPaintProperty: () => {},
  } as never;

  // Must not throw — silently skips on tilesets without buildings.
  assert.doesNotThrow(() => addBuildings3DLayer(map, { dark: true }));
});

test("addBuildings3DLayer falls back to top-of-stack when no symbol layers", () => {
  const { map, addLayerCalls } = makeStubMap({
    sources: { openmaptiles: { type: "vector" } },
    layers: [{ id: "background", type: "background" }],
  });
  addBuildings3DLayer(map as never, { dark: true });
  assert.equal(addLayerCalls.length, 1);
  assert.equal(addLayerCalls[0].beforeId, undefined);
});

test("addBuildings3DLayer filters to polygon geometries only", () => {
  const { map, addLayerCalls } = makeStubMap(freshStyle());
  addBuildings3DLayer(map as never, { dark: true });
  const filter = addLayerCalls[0].spec.filter as unknown[];
  assert.deepEqual(filter, ["==", ["geometry-type"], "Polygon"]);
});

// ─── Paint spec ────────────────────────────────────────────────────────────

test("paint uses darker walls for dark theme and lighter walls for light theme", () => {
  const dark = __internals.buildPaint(true);
  const light = __internals.buildPaint(false);
  assert.notEqual(dark["fill-extrusion-color"], light["fill-extrusion-color"]);
  assert.equal(dark["fill-extrusion-color"], "hsl(0, 0%, 22%)");
  assert.equal(light["fill-extrusion-color"], "hsl(0, 0%, 80%)");
});

test("paint honors user-spec opacity of 0.6", () => {
  assert.equal(__internals.buildPaint(true)["fill-extrusion-opacity"], 0.6);
});

test("height expression coalesces render_height, height, then 0", () => {
  const paint = __internals.buildPaint(true);
  const height = paint["fill-extrusion-height"] as unknown[];
  // ["interpolate", ["linear"], ["zoom"], 15, 0, 16, ["coalesce", ...]]
  assert.equal(height[0], "interpolate");
  assert.deepEqual(height[1], ["linear"]);
  assert.deepEqual(height[2], ["zoom"]);
  assert.equal(height[3], BUILDINGS_3D_MIN_ZOOM);
  assert.equal(height[4], 0);
  assert.equal(height[5], BUILDINGS_3D_MIN_ZOOM + 1);
  const coalesce = height[6] as unknown[];
  assert.equal(coalesce[0], "coalesce");
  assert.deepEqual(coalesce[1], ["get", "render_height"]);
  assert.deepEqual(coalesce[2], ["get", "height"]);
  assert.equal(coalesce[3], 0);
});

test("base expression coalesces render_min_height, min_height, then 0", () => {
  const paint = __internals.buildPaint(true);
  const base = paint["fill-extrusion-base"] as unknown[];
  const coalesce = base[6] as unknown[];
  assert.equal(coalesce[0], "coalesce");
  assert.deepEqual(coalesce[1], ["get", "render_min_height"]);
  assert.deepEqual(coalesce[2], ["get", "min_height"]);
  assert.equal(coalesce[3], 0);
});

// ─── setBuildings3DTheme ───────────────────────────────────────────────────

test("setBuildings3DTheme updates wall color when layer exists", () => {
  const style = freshStyle();
  const { map, paintChanges } = makeStubMap(style);
  addBuildings3DLayer(map as never, { dark: true });
  setBuildings3DTheme(map as never, false);
  assert.equal(paintChanges.length, 1);
  assert.equal(paintChanges[0].layer, BUILDINGS_3D_LAYER_ID);
  assert.equal(paintChanges[0].prop, "fill-extrusion-color");
  assert.equal(paintChanges[0].value, "hsl(0, 0%, 80%)");
});

test("setBuildings3DTheme is a no-op when layer is absent", () => {
  const { map, paintChanges } = makeStubMap(freshStyle());
  setBuildings3DTheme(map as never, false);
  assert.equal(paintChanges.length, 0);
});

test("setBuildings3DTheme swallows setPaintProperty errors", () => {
  const style = freshStyle();
  style.layers.push({
    id: BUILDINGS_3D_LAYER_ID,
    type: "fill-extrusion",
  });
  const map = {
    getStyle: () => style,
    getLayer: (id: string) => style.layers.find((l) => l.id === id),
    setPaintProperty: () => {
      throw new Error("style not ready");
    },
  } as never;
  assert.doesNotThrow(() => setBuildings3DTheme(map, true));
});

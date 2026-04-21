import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AIRSPACE_SOURCE_ID,
  AIRSPACE_LAYERS,
  AIRSPACE_INTERACTIVE_LAYER_IDS,
  AIRSPACE_RENDERED_TYPES,
  AIRSPACE_RADIUS_MULTIPLIER,
  FPV_AIRSPACE_RADIUS_DEG,
  FPV_BOUNDS_SNAP_DEG,
  computeAirspaceBounds,
  airspaceBoundsKey,
} from "./airspace-style";

test("source id is stable", () => {
  assert.equal(AIRSPACE_SOURCE_ID, "openaip-airspace");
});

test("layer definitions share the airspace source", () => {
  for (const layer of AIRSPACE_LAYERS) {
    assert.notEqual(
      layer.type,
      "background",
      `layer ${layer.id} must not be background`,
    );
    if (layer.type === "background") continue;
    assert.equal(
      layer.source,
      AIRSPACE_SOURCE_ID,
      `layer ${layer.id} uses wrong source`,
    );
  }
});

test("layer ids are unique", () => {
  const ids = AIRSPACE_LAYERS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("at least one fill and one line layer exist", () => {
  assert.ok(AIRSPACE_LAYERS.some((l) => l.type === "fill"));
  assert.ok(AIRSPACE_LAYERS.some((l) => l.type === "line"));
  assert.ok(AIRSPACE_LAYERS.some((l) => l.type === "symbol"));
});

test("interactive layers all reference known layer ids", () => {
  const ids = new Set(AIRSPACE_LAYERS.map((l) => l.id));
  for (const id of AIRSPACE_INTERACTIVE_LAYER_IDS) {
    assert.ok(ids.has(id), `interactive id ${id} not in AIRSPACE_LAYERS`);
  }
});

test("rendered types list covers controlled + restricted + tmz/rmz + adiz", () => {
  const expected = [
    "ctr",
    "tma",
    "cta",
    "restricted",
    "danger",
    "prohibited",
    "tfr",
    "tmz",
    "rmz",
    "adiz",
  ];
  for (const t of expected) {
    assert.ok(
      AIRSPACE_RENDERED_TYPES.has(t),
      `expected ${t} in AIRSPACE_RENDERED_TYPES`,
    );
  }
});

test("out-of-scope types are excluded", () => {
  const excluded = ["awy", "fir", "uir", "moa", "gliding_sector"];
  for (const t of excluded) {
    assert.ok(
      !AIRSPACE_RENDERED_TYPES.has(t),
      `${t} should NOT be in AIRSPACE_RENDERED_TYPES`,
    );
  }
});

// ── computeAirspaceBounds ─────────────────────────────────────────

const cityLike = (lng: number, lat: number, radius: number) => ({
  coordinates: [lng, lat] as [number, number],
  radius,
});

test("computeAirspaceBounds: null/undefined city → null", () => {
  assert.equal(computeAirspaceBounds(null), null);
  assert.equal(computeAirspaceBounds(undefined), null);
});

test("computeAirspaceBounds: invalid radius → null", () => {
  assert.equal(computeAirspaceBounds(cityLike(0, 0, 0)), null);
  assert.equal(computeAirspaceBounds(cityLike(0, 0, -1)), null);
  assert.equal(computeAirspaceBounds(cityLike(0, 0, Number.NaN)), null);
  assert.equal(computeAirspaceBounds(cityLike(0, 0, Infinity)), null);
});

test("computeAirspaceBounds: non-finite coordinates → null", () => {
  assert.equal(computeAirspaceBounds(cityLike(Number.NaN, 0, 2.49)), null);
  assert.equal(computeAirspaceBounds(cityLike(0, Infinity, 2.49)), null);
});

test("computeAirspaceBounds: invalid multiplier → null", () => {
  assert.equal(computeAirspaceBounds(cityLike(0, 0, 2.49), 0), null);
  assert.equal(computeAirspaceBounds(cityLike(0, 0, 2.49), -1), null);
  assert.equal(computeAirspaceBounds(cityLike(0, 0, 2.49), Number.NaN), null);
});

test("computeAirspaceBounds: square-ish at the equator", () => {
  const b = computeAirspaceBounds(cityLike(0, 0, 2.49));
  assert.ok(b);
  const [w, s, e, n] = b!;
  const expected = 2.49 * AIRSPACE_RADIUS_MULTIPLIER;
  assert.ok(Math.abs(-expected - w) < 1e-9);
  assert.ok(Math.abs(expected - e) < 1e-9);
  assert.ok(Math.abs(-expected - s) < 1e-9);
  assert.ok(Math.abs(expected - n) < 1e-9);
});

test("computeAirspaceBounds: longitude expands at high latitudes", () => {
  const b = computeAirspaceBounds(cityLike(-0.4614, 51.47, 2.49));
  assert.ok(b);
  const [w, s, e, n] = b!;
  const latSpan = (n - s) / 2;
  const lngSpan = (e - w) / 2;
  assert.ok(lngSpan > latSpan);
  const expectedLng = latSpan / Math.cos((51.47 * Math.PI) / 180);
  assert.ok(Math.abs(lngSpan - expectedLng) / expectedLng < 0.01);
});

test("computeAirspaceBounds: clamps to Mercator lat range", () => {
  const b = computeAirspaceBounds(cityLike(0, 84, 5));
  assert.ok(b);
  const [, , , n] = b!;
  assert.ok(n <= 85.051129 + 1e-9);
});

test("computeAirspaceBounds: clamps to lng range", () => {
  const b = computeAirspaceBounds(cityLike(-179, 0, 10));
  assert.ok(b);
  const [w, , e] = b!;
  assert.ok(w >= -180 - 1e-9);
  assert.ok(e <= 180 + 1e-9);
});

test("computeAirspaceBounds: honours a custom multiplier", () => {
  const def = computeAirspaceBounds(cityLike(0, 0, 1));
  const big = computeAirspaceBounds(cityLike(0, 0, 1), 4);
  assert.ok(def && big);
  const defSpan = def![2] - def![0];
  const bigSpan = big![2] - big![0];
  // default is 2×, custom is 4× → double the width.
  assert.ok(Math.abs(bigSpan / defSpan - 2) < 1e-9);
});

test("airspaceBoundsKey: null → 'none'", () => {
  assert.equal(airspaceBoundsKey(null), "none");
});

test("airspaceBoundsKey: ignores sub-meter drift", () => {
  const a = airspaceBoundsKey([-1, -1, 1, 1]);
  const b = airspaceBoundsKey([-1.0000001, -1, 1, 1]);
  assert.equal(a, b);
});

test("airspaceBoundsKey: differs for meaningfully different boxes", () => {
  const a = airspaceBoundsKey([-1, -1, 1, 1]);
  const b = airspaceBoundsKey([-2, -1, 1, 1]);
  assert.notEqual(a, b);
});

// ── FPV bbox math ─────────────────────────────────────────────────
//
// These tests simulate the calculation the flight-tracker does in FPV
// mode: snap the aircraft center to the 0.5° grid, then feed it to
// computeAirspaceBounds with radius = FPV_AIRSPACE_RADIUS_DEG / 2 and
// the standard 2× multiplier, so the final half-width is exactly
// FPV_AIRSPACE_RADIUS_DEG.

function fpvBounds(lng: number, lat: number) {
  const snap = FPV_BOUNDS_SNAP_DEG;
  const sLng = Math.round(lng / snap) * snap;
  const sLat = Math.round(lat / snap) * snap;
  return computeAirspaceBounds(
    {
      coordinates: [sLng, sLat],
      radius: FPV_AIRSPACE_RADIUS_DEG / AIRSPACE_RADIUS_MULTIPLIER,
    },
    AIRSPACE_RADIUS_MULTIPLIER,
  );
}

test("FPV bbox: half-width equals FPV_AIRSPACE_RADIUS_DEG at the equator", () => {
  const b = fpvBounds(0, 0);
  assert.ok(b);
  const [w, s, e, n] = b!;
  assert.ok(Math.abs(e - w - 2 * FPV_AIRSPACE_RADIUS_DEG) < 1e-9);
  assert.ok(Math.abs(n - s - 2 * FPV_AIRSPACE_RADIUS_DEG) < 1e-9);
});

test("FPV bbox: small aircraft drift inside a snap cell is stable", () => {
  const a = fpvBounds(0.01, 0.01);
  const b = fpvBounds(0.2, 0.24);
  assert.ok(a && b);
  // Both should snap to (0, 0) → identical bounds.
  assert.equal(airspaceBoundsKey(a), airspaceBoundsKey(b));
});

test("FPV bbox: crossing a snap cell boundary re-anchors", () => {
  const a = fpvBounds(0, 0); // snaps to 0
  const b = fpvBounds(0.3, 0); // 0.3 rounds to 0.5
  assert.ok(a && b);
  assert.notEqual(airspaceBoundsKey(a), airspaceBoundsKey(b));
});

test("FPV bbox: longitude scales with latitude (bigger lng span north)", () => {
  const eq = fpvBounds(0, 0)!;
  const nor = fpvBounds(0, 60)!;
  const eqLng = eq[2] - eq[0];
  const norLng = nor[2] - nor[0];
  assert.ok(norLng > eqLng);
});

/**
 * Builds the aircraft models the map draws, into public/models/aircraft,
 * from two sets of sources:
 *
 * - the generic models in tools/models/source (FlightAirMap, GPL v2);
 * - Flightradar24's type-specific models (GPL v2), fetched from their
 *   repository at a pinned commit into tools/models/.cache/fr24 and
 *   upgraded from glTF 1.0. Each is checked to stand Y up with its nose
 *   along -Z, and to measure within 15% of the real aircraft.
 *
 * Each is built at two levels of detail:
 *
 * - `<name>.glb`, light enough to draw a hundred and more at once at city
 *   zoom, where an aircraft is 16 to 30 px wide;
 * - `<name>-detail.glb`, for the one aircraft flown in first person, drawn
 *   up to a few hundred pixels wide.
 *
 * Each model loses its textures, skins and animations, takes one neutral
 * material, is joined into as few draw calls as its scene allows, and is
 * simplified to a triangle budget. Its shape in the world is kept: the
 * bounds must match the source's, or the build fails, so the map's
 * normalisation, sizes and nose directions stay right.
 *
 * Run with `npm run data:models`, then `npm run data:model-tails`.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Document,
  getBounds,
  NodeIO,
  Primitive,
} from "@gltf-transform/core";
import {
  clearNodeTransform,
  compactPrimitive,
  dedup,
  flatten,
  join,
  prune,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "tools/models/source");
const FR24_CACHE = path.join(ROOT, "tools/models/.cache/fr24");
const OUT = path.join(ROOT, "public/models/aircraft");

/** github.com/Flightradar24/fr24-3d-models, the commit the models come from. */
const FR24_COMMIT = "dd53267690c6a4ecbb290a3acf0284333a5d68a9";

/**
 * Flightradar24's models, by file name, with the real aircraft's wingspan
 * and length in metres to check them against. b736 is left out: its model
 * is 5 m too long. b737 is already among the generic sources.
 */
const FR24_MODELS: Readonly<Record<string, readonly [number, number]>> = {
  a318: [34.1, 31.4],
  a319: [35.8, 33.8],
  a320: [35.8, 37.6],
  a321: [35.8, 44.5],
  a332: [60.3, 58.8],
  a333: [60.3, 63.7],
  a343: [60.3, 63.6],
  a346: [63.5, 75.4],
  a359: [64.8, 66.8],
  a380: [79.8, 72.7],
  b738: [35.8, 39.5],
  b739: [35.8, 42.1],
  b744: [64.4, 70.6],
  b748: [68.4, 76.3],
  b752: [38.1, 47.3],
  b753: [38.1, 54.4],
  b762: [47.6, 48.5],
  b763: [47.6, 54.9],
  b764: [51.9, 61.4],
  b772: [60.9, 63.7],
  b773: [60.9, 73.9],
  b788: [60.1, 56.7],
  b789: [60.1, 62.8],
  e170: [26.0, 29.9],
  e190: [28.7, 36.2],
  crj700: [23.2, 32.3],
  crj900: [24.9, 36.2],
  cs100: [35.1, 35.0],
  cs300: [35.1, 38.7],
  q400: [28.4, 32.8],
  // The model's wings are 2.6 m wider than the real ATR 42's.
  atr42: [24.6, 22.7],
  bae146: [26.3, 28.6],
  citation: [15.9, 15.6],
  pa28: [10.7, 7.3],
};
/** How far a model may measure from the real aircraft. */
const REAL_SIZE_TOLERANCE = 0.15;

/** The generic models, by file name. */
const GENERIC_FILES = [
  "b737",
  "bizjet",
  "fighter",
  "glider",
  "helicopter",
  "light-prop",
  "narrowbody",
  "regional-jet",
  "turboprop",
  "widebody-2eng",
  "widebody-4eng",
] as const;

/** Every model the map loads, by file name. */
export const MODEL_FILES: readonly string[] = [
  ...GENERIC_FILES,
  ...Object.keys(FR24_MODELS),
];

/** Triangle budgets for the two levels of detail. */
const MAP_TRIANGLES = 1_200;
const DETAIL_TRIANGLES = 8_000;
/**
 * How far simplification may move the surface, as a share of the model's
 * size. Loose for the map, where a model is a few dozen pixels across.
 */
const MAP_ERROR = 0.02;
const DETAIL_ERROR = 0.004;
/**
 * Per-model map settings, for meshes the defaults don't suit. Read from
 * MODEL_MAP_SETTINGS (JSON) too, to try settings without editing.
 */
type MapSettings = { error?: number; dropSmallParts?: boolean };
const MAP_SETTINGS: Record<string, MapSettings> = {
  // The A380 mesh is 180 separate panels: dropping small parts takes the
  // fuselage and engines with them, and the panels stop it near 10,000
  // triangles whatever the error, so it is kept close to the source.
  "widebody-4eng": { error: 0.005, dropSmallParts: false },
  // Flightradar24's A380 likewise: its upper deck goes with small parts.
  a380: { error: 0.005, dropSmallParts: false },
  // The ATR 42's engine nacelles are small parts of their own, and narrow
  // enough that a looser error flattens them away.
  atr42: { error: 0.004, dropSmallParts: false },
  ...JSON.parse(process.env.MODEL_MAP_SETTINGS ?? "{}"),
};

/**
 * The map draws a model centred on its bounds and scaled by its larger
 * span across X and Z (normalizeScene in aircraft-model-layers.ts), so
 * those are what simplification may barely move, as a share of the span.
 * A map model is a few dozen pixels across: 2% is under a pixel.
 */
const MAP_LIMITS = { span: 0.01, centre: 0.02 };
const DETAIL_LIMITS = { span: 0.005, centre: 0.005 };

type Bounds = { min: number[]; max: number[] };
type Limits = { span: number; centre: number };

function triangles(doc: Document): number {
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute("POSITION");
      count += (indices ? indices.getCount() : (position?.getCount() ?? 0)) / 3;
    }
  }
  return Math.round(count);
}

function primitives(doc: Document): number {
  return doc
    .getRoot()
    .listMeshes()
    .reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0);
}

function sceneBounds(doc: Document): Bounds {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  return getBounds(scene);
}

/** The larger span across X and Z, which the map scales a model by. */
function footprintSpan(b: Bounds): number {
  return Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
}

/** How much a model would move and resize where the map draws it. */
function normalisationShift(source: Bounds, out: Bounds) {
  const span = footprintSpan(source);
  let centre = 0;
  for (let i = 0; i < 3; i += 1) {
    const a = (source.min[i] + source.max[i]) / 2;
    const b = (out.min[i] + out.max[i]) / 2;
    centre = Math.max(centre, Math.abs(a - b) / span);
  }
  return { span: Math.abs(footprintSpan(out) / span - 1), centre };
}

/**
 * Simplifies one triangle primitive to `ratio` of its triangles, keeping
 * the model's outermost point in each direction. A flat part such as a
 * rotor blade has no thickness, so shortening its tip costs the simplifier
 * nothing; holding the six extremes keeps the bounds, and with them where
 * and how big the map draws the model, exactly as they were.
 */
function simplifyKeepingExtent(
  prim: Primitive,
  ratio: number,
  error: number,
  dropSmallParts: boolean,
): void {
  const position = prim.getAttribute("POSITION");
  const indices = prim.getIndices();
  if (!position || !indices) return;
  const positions = Float32Array.from(position.getArray()!);
  const vertexCount = position.getCount();

  // One vertex per direction is enough to hold the bounds; a flat face on
  // an extreme would otherwise lock hundreds and stop the simplifier.
  const extremes = new Set<number>();
  for (let axis = 0; axis < 3; axis += 1) {
    let low = 0;
    let high = 0;
    for (let v = 1; v < vertexCount; v += 1) {
      if (positions[v * 3 + axis] < positions[low * 3 + axis]) low = v;
      if (positions[v * 3 + axis] > positions[high * 3 + axis]) high = v;
    }
    extremes.add(low);
    extremes.add(high);
  }

  // A locked vertex never moves, but its neighbours can collapse into one
  // another and leave it in no triangle at all. Locking every corner of a
  // triangle that touches an extreme keeps that triangle whole.
  const source = Uint32Array.from(indices.getArray()!);
  const lock = new Uint8Array(vertexCount);
  for (let t = 0; t < source.length; t += 3) {
    const [a, b, c] = [source[t], source[t + 1], source[t + 2]];
    if (extremes.has(a) || extremes.has(b) || extremes.has(c)) {
      lock[a] = 1;
      lock[b] = 1;
      lock[c] = 1;
    }
  }

  const target = Math.max(3, Math.floor((source.length * ratio) / 3) * 3);
  // The models carry positions only, and deck lights them without normals,
  // so no attribute counts: the call is for its vertex lock.
  const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    source,
    positions,
    3,
    positions,
    3,
    [0, 0, 0],
    lock,
    target,
    error,
    // Small separate pieces (windows, antennas) are under a pixel on the
    // map; dropping them is what lets a busy mesh reach its budget.
    dropSmallParts ? ["Prune"] : [],
  );
  indices.setArray(Uint32Array.from(simplified));
  compactPrimitive(prim);
}

const require = createRequire(import.meta.url);

/**
 * A Flightradar24 model as glTF 2.0: fetched once into the cache, upgraded
 * from glTF 1.0 with gltf-pipeline, and cleared of the materials,
 * techniques and skins gltf-transform cannot read and the build drops.
 */
async function readFr24(io: NodeIO, name: string): Promise<Document> {
  const cached = path.join(FR24_CACHE, `${name}.glb`);
  if (!existsSync(cached)) {
    mkdirSync(FR24_CACHE, { recursive: true });
    const url = `https://raw.githubusercontent.com/Flightradar24/fr24-3d-models/${FR24_COMMIT}/models/${name}.glb`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: ${response.status} from ${url}`);
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }
  const pipeline = require("gltf-pipeline");
  const { gltf: version1 } = await pipeline.glbToGltf(readFileSync(cached));
  const { gltf } = await pipeline.processGltf(version1, {});
  delete gltf.extensionsUsed;
  delete gltf.extensionsRequired;
  delete gltf.extensions;
  for (const key of ["materials", "textures", "images", "samplers", "skins", "animations", "techniques"]) {
    delete gltf[key];
  }
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives) {
      delete prim.material;
      delete prim.extensions;
    }
  }
  for (const node of gltf.nodes ?? []) {
    delete node.skin;
    delete node.extensions;
  }
  const { glb } = await pipeline.gltfToGlb(gltf, {});
  return io.readBinary(new Uint8Array(glb));
}

async function readSource(io: NodeIO, name: string): Promise<Document> {
  return name in FR24_MODELS
    ? readFr24(io, name)
    : io.read(path.join(SOURCE, `${name}.glb`));
}

/**
 * A Flightradar24 model must stand Y up with its nose along -Z, like the
 * b737 the map already draws with no turn, and measure like the aircraft
 * it is: its tail, the top of its fin, sits towards +Z.
 */
function checkFr24(doc: Document, name: string): void {
  const [span, length] = FR24_MODELS[name];
  const bounds = sceneBounds(doc);
  const extent = bounds.max.map((max, i) => max - bounds.min[i]);
  const off = (got: number, want: number) => Math.abs(got / want - 1);
  if (off(extent[0], span) > REAL_SIZE_TOLERANCE || off(extent[2], length) > REAL_SIZE_TOLERANCE) {
    throw new Error(
      `${name}: measures ${extent[0].toFixed(1)} m across X and ${extent[2].toFixed(1)} m along Z, not ${span} by ${length}`,
    );
  }
  // The highest tenth of a percent of vertices is the fin's top.
  const points: number[][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION")!;
      for (let i = 0; i < position.getCount(); i += 1) points.push(position.getElement(i, [0, 0, 0]));
    }
  }
  points.sort((a, b) => b[1] - a[1]);
  const top = points.slice(0, Math.max(3, Math.floor(points.length / 1000)));
  const finZ = top.reduce((sum, p) => sum + p[2], 0) / top.length;
  const centreZ = (bounds.min[2] + bounds.max[2]) / 2;
  if (finZ - centreZ < 0.2 * extent[2]) {
    throw new Error(`${name}: its fin is not towards +Z, so its nose is not along -Z`);
  }
}

/**
 * Drops triangles with no area: wires and probes drawn as slivers (the
 * a343 source has one 3 m past its nose). They draw nothing, but they
 * stretch the bounds the map sizes the model by, and the simplifier drops
 * them anyway, locked or not.
 */
function dropFlatTriangles(prim: Primitive): void {
  const indices = prim.getIndices();
  const position = prim.getAttribute("POSITION");
  if (!indices || !position) return;
  const p = position.getArray()!;
  const source = indices.getArray()!;
  let size = 0;
  for (let i = 0; i < p.length; i += 1) size = Math.max(size, Math.abs(p[i]));
  const flat = (size * 1e-6) ** 2;
  const kept: number[] = [];
  for (let t = 0; t < source.length; t += 3) {
    const [a, b, c] = [source[t] * 3, source[t + 1] * 3, source[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const cross = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2 > flat) {
      kept.push(source[t], source[t + 1], source[t + 2]);
    }
  }
  if (kept.length < source.length) {
    indices.setArray(Uint32Array.from(kept));
    compactPrimitive(prim);
  }
}

/** Textures, skins and animations go; every surface gets one material. */
function strip(doc: Document): void {
  const root = doc.getRoot();
  for (const animation of root.listAnimations()) animation.dispose();
  for (const node of root.listNodes()) node.setSkin(null);
  for (const skin of root.listSkins()) skin.dispose();
  for (const texture of root.listTextures()) texture.dispose();

  const neutral = doc
    .createMaterial("aircraft")
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.6);
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      // Lines and points have no surface to draw.
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) {
        prim.dispose();
        continue;
      }
      prim.setMaterial(neutral);
      // Positions alone: deck lights the models without normals, and flat
      // normals would split every face from its neighbours, so nothing
      // could be welded or simplified.
      for (const semantic of prim.listSemantics()) {
        if (semantic !== "POSITION") prim.setAttribute(semantic, null);
      }
      dropFlatTriangles(prim);
    }
  }
  for (const material of root.listMaterials()) {
    if (material !== neutral) material.dispose();
  }
}

async function build(
  io: NodeIO,
  name: string,
  budget: number,
  error: number,
  suffix: string,
  limits: Limits,
  dropSmallParts: boolean,
): Promise<string> {
  const doc = await readSource(io, name);
  const sourceTriangles = triangles(doc);

  // Bounds are compared on surfaces alone: a source can carry stray lines
  // or points (b737 has a line 5 m below its belly) that only skew where
  // the model is centred and how big it is drawn.
  strip(doc);
  const sourceBounds = sceneBounds(doc);
  const trace = (stage: string) => {
    if (process.env.MODEL_TRACE) {
      const b = sceneBounds(doc);
      console.log(`  ${stage}: ${b.max.map((max, i) => (max - b.min[i]).toFixed(2)).join(" x ")}`);
    }
  };
  trace("stripped");
  await doc.transform(prune(), dedup());
  trace("pruned");
  await doc.transform(flatten(), join({ keepNamed: false }));
  trace("joined");
  // Vertices in world space, so the extremes found are the scene's.
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()) clearNodeTransform(node);
  }
  trace("baked");
  if (name in FR24_MODELS) checkFr24(doc, name);
  await doc.transform(weld());
  trace("welded");
  const welded = triangles(doc);
  const ratio = Math.min(1, budget / welded);
  if (ratio < 1) {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        simplifyKeepingExtent(prim, ratio, error, dropSmallParts);
      }
    }
  }
  trace("simplified");
  await doc.transform(prune(), dedup());
  trace("final");

  const shift = normalisationShift(sourceBounds, sceneBounds(doc));
  const file = path.join(OUT, `${name}${suffix}.glb`);
  await io.write(file, doc);
  const line = `${(name + suffix).padEnd(22)} ${String(sourceTriangles).padStart(6)} → ${String(triangles(doc)).padStart(6)} tris  ${String(primitives(doc)).padStart(2)} draw  ${String(Math.round(statSync(file).size / 1024)).padStart(4)} KB  span ${(shift.span * 100).toFixed(2)}%  centre ${(shift.centre * 100).toFixed(2)}%`;
  if (shift.span > limits.span || shift.centre > limits.centre) {
    throw new Error(`${line}\n${name}${suffix}: simplifying moved or resized the model too much`);
  }
  return line;
}

/**
 * Builds the map model, dropping small parts unless that takes a piece the
 * model's extent rests on (a wingtip or winglet built as its own part),
 * in which case it builds again keeping them.
 */
async function buildMap(io: NodeIO, name: string): Promise<string> {
  const settings = MAP_SETTINGS[name] ?? {};
  const error = settings.error ?? MAP_ERROR;
  const dropSmallParts = settings.dropSmallParts ?? true;
  try {
    return await build(io, name, MAP_TRIANGLES, error, "", MAP_LIMITS, dropSmallParts);
  } catch (failure) {
    if (!dropSmallParts) throw failure;
    const line = await build(io, name, MAP_TRIANGLES, error, "", MAP_LIMITS, false);
    return `${line}  (small parts kept)`;
  }
}

async function main(): Promise<void> {
  await MeshoptSimplifier.ready;
  mkdirSync(OUT, { recursive: true });
  const io = new NodeIO();
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const names = only.length ? only : MODEL_FILES;
  for (const name of names) {
    console.log(await buildMap(io, name));
    console.log(
      await build(io, name, DETAIL_TRIANGLES, DETAIL_ERROR, "-detail", DETAIL_LIMITS, false),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

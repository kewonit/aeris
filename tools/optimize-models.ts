/**
 * Builds the aircraft models the map draws from the sources in
 * tools/models/source, into public/models/aircraft:
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
import { mkdirSync, statSync } from "node:fs";
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
const OUT = path.join(ROOT, "public/models/aircraft");

/** The models the map loads, by file name. */
export const MODEL_FILES = [
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
      for (const semantic of prim.listSemantics()) {
        if (semantic !== "POSITION" && semantic !== "NORMAL") {
          prim.setAttribute(semantic, null);
        }
      }
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
  const doc = await io.read(path.join(SOURCE, `${name}.glb`));
  const sourceTriangles = triangles(doc);

  // Bounds are compared on surfaces alone: a source can carry stray lines
  // or points (b737 has a line 5 m below its belly) that only skew where
  // the model is centred and how big it is drawn.
  strip(doc);
  const sourceBounds = sceneBounds(doc);
  await doc.transform(
    prune(),
    dedup(),
    flatten(),
    join({ keepNamed: false }),
  );
  // Vertices in world space, so the extremes found are the scene's.
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()) clearNodeTransform(node);
  }
  await doc.transform(weld());
  const welded = triangles(doc);
  const ratio = Math.min(1, budget / welded);
  if (ratio < 1) {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        simplifyKeepingExtent(prim, ratio, error, dropSmallParts);
      }
    }
  }
  await doc.transform(prune(), dedup());

  const shift = normalisationShift(sourceBounds, sceneBounds(doc));
  const file = path.join(OUT, `${name}${suffix}.glb`);
  await io.write(file, doc);
  const line = `${(name + suffix).padEnd(22)} ${String(sourceTriangles).padStart(6)} → ${String(triangles(doc)).padStart(6)} tris  ${String(primitives(doc)).padStart(2)} draw  ${String(Math.round(statSync(file).size / 1024)).padStart(4)} KB  span ${(shift.span * 100).toFixed(2)}%  centre ${(shift.centre * 100).toFixed(2)}%`;
  if (shift.span > limits.span || shift.centre > limits.centre) {
    throw new Error(`${line}\n${name}${suffix}: simplifying moved or resized the model too much`);
  }
  return line;
}

async function main(): Promise<void> {
  await MeshoptSimplifier.ready;
  mkdirSync(OUT, { recursive: true });
  const io = new NodeIO();
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const names = only.length ? only : MODEL_FILES;
  for (const name of names) {
    const settings = MAP_SETTINGS[name] ?? {};
    console.log(
      await build(
        io,
        name,
        MAP_TRIANGLES,
        settings.error ?? MAP_ERROR,
        "",
        MAP_LIMITS,
        settings.dropSmallParts ?? true,
      ),
    );
    console.log(
      await build(io, name, DETAIL_TRIANGLES, DETAIL_ERROR, "-detail", DETAIL_LIMITS, false),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

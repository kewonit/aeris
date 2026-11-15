/**
 * Measures where each aircraft model's tail cone ends, so a trail can run
 * out of it rather than out of the fin, and writes the table to
 * src/components/map/model-tail-points.ts.
 *
 * Each model is put in the frame the map draws it in, exactly as
 * normalizeScene does: centred on its bounding box, nose along +X, Y up,
 * its larger span one unit. Then, from its vertices:
 * - the fuselage's axis height is the middle of the fuselage where it
 *   crosses the centre plane at mid-length;
 * - the tail cone's end is the rearmost fuselage point near the centre
 *   plane, ignoring the fin, which rises above the fuselage's top.
 *
 * Run with `npm run data:model-tails`; pass --plot to print each model's
 * side view with the point marked.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "@loaders.gl/core";
import { GLTFLoader, postProcessGLTF } from "@loaders.gl/gltf";

import {
  ALL_MODEL_KEYS,
  modelNoseTurn,
  resolveModelFileKey,
  type AircraftModelKey,
} from "../src/components/map/aircraft-model-mapping";

type Vec3 = [number, number, number];
type Matrix = number[];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "public/models/aircraft");
const OUT = path.join(ROOT, "src/components/map/model-tail-points.ts");

/** Half the width of the fuselage, about, as a share of a unit. */
const FUSELAGE = 0.06;
/**
 * The share of the fuselage, either side of its middle, its height is read
 * from; the tail cone is looked for behind it.
 */
const MID_SHARE = 0.6;
/**
 * How far above the fuselage's top, as a share of its height, the tail
 * cone may sweep up.
 */
const CONE_SWEEP = 0.1;
/** The tail point sits this far inside the cone's end, along the fuselage. */
const INSIDE = 0.01;

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
      }
    }
  }
  return out;
}

function fromTRS(node: {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}): Matrix {
  if (node.matrix) return [...node.matrix];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function point(m: Matrix, [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function vector(m: Matrix, [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

type Primitive = {
  matrix: Matrix;
  positions: Float32Array;
  min: Vec3;
  max: Vec3;
};

/** The parts of a post-processed glTF this reads. */
type GltfNode = {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  mesh?: {
    primitives: {
      attributes: {
        POSITION: { value: Float32Array; min: Vec3; max: Vec3 };
      };
    }[];
  };
  children?: GltfNode[];
};
type GltfScene = { nodes: GltfNode[] };
type Gltf = { scene?: number | GltfScene; scenes: GltfScene[] };

/** Every mesh primitive in the scene, with its node's matrix. */
function primitives(gltf: Gltf): Primitive[] {
  const out: Primitive[] = [];
  // As deck chooses it: the default scene, or the first.
  const scene =
    typeof gltf.scene === "object" ? gltf.scene : gltf.scenes[gltf.scene ?? 0];
  const visit = (node: GltfNode, parent: Matrix) => {
    const matrix = multiply(parent, fromTRS(node));
    for (const primitive of node.mesh?.primitives ?? []) {
      const position = primitive.attributes.POSITION;
      out.push({
        matrix,
        positions: position.value,
        min: position.min,
        max: position.max,
      });
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const node of scene.nodes) visit(node, identity);
  return out;
}

/** The scene's bounds as luma's GroupNode.getBounds works them out. */
function lumaBounds(parts: Primitive[]): [Vec3, Vec3] {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const centre = point(
      part.matrix,
      part.min.map((v, i) => (v + part.max[i]) / 2) as Vec3,
    );
    const half = vector(
      part.matrix,
      part.max.map((v, i) => (v - part.min[i]) / 2) as Vec3,
    );
    for (let corner = 0; corner < 8; corner += 1) {
      const signs = [1, 2, 4].map((bit) => (corner & bit ? -1 : 1));
      for (let i = 0; i < 3; i += 1) {
        const value = centre[i] + signs[i] * half[i];
        min[i] = Math.min(min[i], value);
        max[i] = Math.max(max[i], value);
      }
    }
  }
  return [min, max];
}

/** Every vertex in the frame the map draws the model in. */
function normalisedVertices(parts: Primitive[], noseTurn: number): Vec3[] {
  const [min, max] = lumaBounds(parts);
  const [cx, cy, cz] = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const scale = 1 / Math.max(max[0] - min[0], max[2] - min[2]);
  const radians = (noseTurn * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians) * 1e9) / 1e9;
  const sin = Math.round(Math.sin(radians) * 1e9) / 1e9;
  const out: Vec3[] = [];
  for (const part of parts) {
    for (let index = 0; index < part.positions.length; index += 3) {
      const [x, y, z] = point(part.matrix, [
        part.positions[index],
        part.positions[index + 1],
        part.positions[index + 2],
      ]);
      out.push([
        scale * (cos * (x - cx) + sin * (z - cz)),
        scale * (y - cy),
        scale * (cos * (z - cz) - sin * (x - cx)),
      ]);
    }
  }
  return out;
}

type TailPoint = { back: number; up: number };

function measure(
  vertices: Vec3[],
): TailPoint & { bottom: number; top: number } {
  // The fuselage's height along its middle, wings and engines aside:
  // everything within its width there, ignoring a stray few points.
  const body = vertices.filter(([, , z]) => Math.abs(z) < FUSELAGE);
  const length = Math.min(
    -Math.min(...body.map(([x]) => x)),
    Math.max(...body.map(([x]) => x)),
  );
  const middle = length * MID_SHARE;
  const heights = body
    .filter(([x]) => Math.abs(x) < middle)
    .map(([, y]) => y)
    .sort((a, b) => a - b);
  const bottom = heights[Math.floor(heights.length * 0.02)];
  const top = heights[Math.floor(heights.length * 0.98)];
  // Behind it, the rearmost point within that height, where the cone may
  // sweep up to the fuselage's top line, but not up the fin.
  const ceiling = top + (top - bottom) * CONE_SWEEP;
  const fuselage = body.filter(
    ([x, y]) => x < -middle && y >= bottom && y <= ceiling,
  );
  const rearmost = Math.min(...fuselage.map(([x]) => x));
  const end = fuselage.filter(([x]) => x < rearmost + 0.015);
  const up = end.reduce((sum, [, y]) => sum + y, 0) / end.length;
  return { back: -rearmost - INSIDE, up, bottom, top };
}

/** A rough side view of the rear of the model, with the tail point. */
function plot(vertices: Vec3[], tail: TailPoint): string {
  const width = 72;
  const height = 22;
  const rows = Array.from({ length: height }, () => Array(width).fill(" "));
  const toColumn = (x: number) => Math.round(((x + 0.55) / 0.6) * (width - 1));
  const toRow = (y: number) => Math.round(((0.2 - y) / 0.4) * (height - 1));
  for (const [x, y, z] of vertices) {
    if (Math.abs(z) > FUSELAGE) continue;
    const [column, row] = [toColumn(x), toRow(y)];
    if (column >= 0 && column < width && row >= 0 && row < height) {
      rows[row][column] = ".";
    }
  }
  const [column, row] = [toColumn(-tail.back), toRow(tail.up)];
  if (rows[row]?.[column] !== undefined) rows[row][column] = "X";
  return rows.map((row) => row.join("")).join("\n");
}

async function main(): Promise<void> {
const files = new Map<string, TailPoint>();
const table: [AircraftModelKey, TailPoint][] = [];
for (const key of ALL_MODEL_KEYS) {
  const file = resolveModelFileKey(key);
  const noseTurn = modelNoseTurn(key);
  const cacheKey = `${file}@${noseTurn}`;
  let tail = files.get(cacheKey);
  if (!tail) {
    const buffer = readFileSync(path.join(MODELS, `${file}.glb`));
    const gltf = postProcessGLTF(
      await parse(buffer.buffer, GLTFLoader, {
        gltf: { loadImages: false },
      }),
    ) as unknown as Gltf;
    const vertices = normalisedVertices(primitives(gltf), noseTurn);
    const measured = measure(vertices);
    const xs = vertices.map(([x]) => x);
    const before = (0.9 * (Math.max(...xs) - Math.min(...xs))) / 2;
    tail = { back: measured.back, up: measured.up };
    files.set(cacheKey, tail);
    console.log(
      [
        `${key} (${file}):`,
        `back ${tail.back.toFixed(3)}, up ${tail.up.toFixed(3)};`,
        `fuselage ${measured.bottom.toFixed(3)} to ${measured.top.toFixed(3)};`,
        `was back ${before.toFixed(3)}, up 0`,
      ].join(" "),
    );
    if (process.argv.includes("--plot")) console.log(plot(vertices, tail));
  }
  table.push([key, tail]);
}

const round = (value: number) => Math.round(value * 1000) / 1000;
writeFileSync(
  OUT,
  `// Written by tools/model-tails.ts from public/models/aircraft. Do not edit.

import type { AircraftModelKey } from "./aircraft-model-mapping";

/**
 * Where each model's tail cone ends, a little inside it, in the frame the
 * map draws the model in: how far behind its centre and how far above it,
 * as shares of its footprint, the larger of its wingspan and length.
 */
export const MODEL_TAIL_POINTS: Readonly<
  Record<AircraftModelKey, { back: number; up: number }>
> = {
${table
  .map(([key, tail]) => {
    const name = /^[a-z0-9]+$/.test(key) ? key : JSON.stringify(key);
    return `  ${name}: { back: ${round(tail.back)}, up: ${round(tail.up)} },`;
  })
  .join("\n")}
};
`,
);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

void main();

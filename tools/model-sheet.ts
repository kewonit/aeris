/**
 * Draws a contact sheet of aircraft models, to check them by eye: each
 * model from above and from the side, normalised and turned nose along +X
 * exactly as the map draws it, large and at map size, with up to three
 * versions side by side (for example the source, the map model and the
 * detail model).
 *
 *   npx tsx tools/model-sheet.ts <out.png> <dir>[=label] [<dir>[=label] …]
 *     [--suffix=-detail] [--only=b737,narrowbody]
 *
 * Models are listed from the first directory; each is read from every one.
 * Software rasterised: flat shading from one light, no dependencies beyond
 * pngjs.
 */
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { NodeIO, type Node, Primitive } from "@gltf-transform/core";
import { PNG } from "pngjs";

import { modelNoseTurn, type AircraftModelKey } from "../src/components/map/aircraft-model-mapping";

type Vec3 = [number, number, number];
type Triangle = [Vec3, Vec3, Vec3];



const BIG = 220;
const SMALL = 44;
const GAP = 8;

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c += 1)
    for (let r = 0; r < 4; r += 1)
      for (let k = 0; k < 4; k += 1) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function apply(m: number[], [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** World-space triangles of a model, normalised the way the map does it. */
async function loadTriangles(io: NodeIO, file: string, key: AircraftModelKey): Promise<Triangle[]> {
  const doc = await io.read(file);
  const tris: Triangle[] = [];
  const visit = (node: Node, parent: number[]) => {
    const world = multiply(parent, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
        const pos = prim.getAttribute("POSITION")!;
        const idx = prim.getIndices();
        const count = idx ? idx.getCount() : pos.getCount();
        const v = (i: number) => apply(world, pos.getElement(idx ? idx.getScalar(i) : i, [0, 0, 0]) as Vec3);
        for (let i = 0; i < count; i += 3) tris.push([v(i), v(i + 1), v(i + 2)]);
      }
    }
    for (const child of node.listChildren()) visit(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const node of doc.getRoot().listScenes()[0].listChildren()) visit(node, identity);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let i = 0; i < 3; i += 1) {
    min[i] = Math.min(min[i], p[i]);
    max[i] = Math.max(max[i], p[i]);
  }
  const centre = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const scale = 1 / Math.max(max[0] - min[0], max[2] - min[2]);
  const turn = (modelNoseTurn(key) * Math.PI) / 180;
  const cos = Math.round(Math.cos(turn) * 1e9) / 1e9;
  const sin = Math.round(Math.sin(turn) * 1e9) / 1e9;
  // Same as normalizeScene: centre, scale, turn about Y so the nose is +X.
  return tris.map((t) =>
    t.map(([x, y, z]) => {
      const [cx, cy, cz] = [(x - centre[0]) * scale, (y - centre[1]) * scale, (z - centre[2]) * scale];
      return [cos * cx + sin * cz, cy, -sin * cx + cos * cz] as Vec3;
    }) as Triangle,
  );
}

/** Rasterises triangles into a square tile, looking down the given axis. */
function draw(
  png: PNG,
  ox: number,
  oy: number,
  size: number,
  tris: Triangle[],
  view: "top" | "side",
): void {
  const depth = new Float32Array(size * size).fill(-Infinity);
  const light: Vec3 = view === "top" ? [0.3, 0.9, 0.3] : [0.3, 0.5, 0.8];
  const len = Math.hypot(...light);
  const L = light.map((c) => c / len);
  // Screen x is +X (nose right); screen y is -Z from above, -Y from the side.
  const project = ([x, y, z]: Vec3): Vec3 =>
    view === "top"
      ? [(x + 0.5) * (size - 1), (z + 0.5) * (size - 1), y]
      : [(x + 0.5) * (size - 1), (0.5 - y) * (size - 1), z];
  for (const t of tris) {
    const [a, b, c] = t;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    const shade = 0.3 + 0.7 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    const [p0, p1, p2] = t.map(project);
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const x = px + 0.5;
        const y = py + 0.5;
        const w0 = ((p1[0] - x) * (p2[1] - y) - (p2[0] - x) * (p1[1] - y)) / area;
        const w1 = ((p2[0] - x) * (p0[1] - y) - (p0[0] - x) * (p2[1] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const d = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const k = py * size + px;
        if (d <= depth[k]) continue;
        depth[k] = d;
        const o = ((oy + py) * png.width + (ox + px)) * 4;
        const v = Math.round(255 * shade);
        png.data[o] = v;
        png.data[o + 1] = v;
        png.data[o + 2] = v;
        png.data[o + 3] = 255;
      }
    }
  }
}

async function main(): Promise<void> {
  const [out, ...rest] = process.argv.slice(2);
  const suffixArg = rest.find((a) => a.startsWith("--suffix="));
  const sources = rest
    .filter((a) => !a.startsWith("--"))
    .map((arg) => {
      const [dir, label] = arg.split("=");
      const suffix = label?.endsWith("-detail") ? "-detail" : "";
      return { dir, label: label ?? path.basename(dir), suffix };
    });
  if (!out || sources.length === 0) {
    throw new Error("usage: model-sheet.ts <out.png> <dir>[=label] …");
  }
  const globalSuffix = suffixArg ? suffixArg.slice("--suffix=".length) : "";
  const onlyArg = rest.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
  const io = new NodeIO();
  const files = readdirSync(sources[0].dir)
    .filter((f) => f.endsWith(".glb") && !f.endsWith("-detail.glb"))
    .map((f) => f.slice(0, -".glb".length))
    .sort()
    .filter((f) => !only || only.includes(f)).filter((f) => sources.every((s) => existsSync(path.join(s.dir, `${f}${s.suffix || globalSuffix}.glb`))));
  // Columns per source: top big, side big, top small, side small.
  const colWidth = BIG * 2 + SMALL * 2 + GAP * 4;
  const width = colWidth * sources.length + GAP;
  const height = files.length * (BIG + GAP) + GAP;
  const png = new PNG({ width, height });
  png.data.fill(30);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;

  for (const [row, file] of files.entries()) {
    const y = GAP + row * (BIG + GAP);
    for (const [col, source] of sources.entries()) {
      const tris = await loadTriangles(io, path.join(source.dir, `${file}${source.suffix || globalSuffix}.glb`), file as AircraftModelKey);
      const x = GAP + col * colWidth;
      draw(png, x, y, BIG, tris, "top");
      draw(png, x + BIG + GAP, y, BIG, tris, "side");
      draw(png, x + BIG * 2 + GAP * 2, y, SMALL, tris, "top");
      draw(png, x + BIG * 2 + SMALL + GAP * 3, y, SMALL, tris, "side");
      if (row === 0) console.log(`column ${col + 1}: ${source.label}`);
    }
    console.log(`row ${row + 1}: ${file}`);
  }
  await new Promise<void>((resolve, reject) =>
    png.pack().pipe(createWriteStream(out)).on("finish", resolve).on("error", reject),
  );
  console.log(`wrote ${out} (${width}×${height})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

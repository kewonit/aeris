/**
 * generate-helicopter-glb.js
 *
 * Generates a minimal but recognizable low-poly helicopter as a GLB file.
 * Runs with plain Node.js — no external dependencies required.
 *
 * Usage: node scripts/generate-helicopter-glb.js
 * Output: public/models/helicopter.glb
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Flatten an array of [x,y,z] vertices into a Float32Array */
function packF32(triples) {
    const buf = new Float32Array(triples.length * 3);
    triples.forEach(([x, y, z], i) => {
        buf[i * 3] = x;
        buf[i * 3 + 1] = y;
        buf[i * 3 + 2] = z;
    });
    return buf;
}

/** Flatten triangle index triplets into a Uint16Array */
function packU16(triples) {
    const buf = new Uint16Array(triples.length * 3);
    triples.forEach(([a, b, c], i) => {
        buf[i * 3] = a;
        buf[i * 3 + 1] = b;
        buf[i * 3 + 2] = c;
    });
    return buf;
}

// ---------------------------------------------------------------------------
// Helicopter geometry (low-poly, ~120 triangles)
// Model space: nose = +Y, top = +Z, right = +X
// Origin at centroid so deck.gl rotation works correctly.
// ---------------------------------------------------------------------------

// ── Fuselage (tapered box) ────────────────────────────────────────────────
const fuselageVerts = [
    // Front (nose) face  z: -0.15..0.25, y: +0.9
    [-0.1, 0.9, -0.15], [0.1, 0.9, -0.15], [0.1, 0.9, 0.25], [-0.1, 0.9, 0.25],
    // Mid face            z: -0.25..0.35, y: 0.0
    [-0.3, 0.0, -0.25], [0.3, 0.0, -0.25], [0.3, 0.0, 0.35], [-0.3, 0.0, 0.35],
    // Tail face           z: -0.10..0.15, y: -1.0
    [-0.08, -1.0, -0.10], [0.08, -1.0, -0.10], [0.08, -1.0, 0.15], [-0.08, -1.0, 0.15],
];

const fuselageFaces = [
    // top (0-3 front, 4-7 mid, 8-11 tail – connecting quads)
    [0, 4, 7], [0, 7, 3],   // left-front-mid
    [1, 2, 6], [1, 6, 5],   // right-front-mid
    [3, 7, 6], [3, 6, 2],   // top front-mid
    [0, 1, 5], [0, 5, 4],   // bottom front-mid
    [4, 8, 11], [4, 11, 7], // left-mid-tail
    [5, 6, 10], [5, 10, 9], // right-mid-tail — wait, corrected below
    [7, 11, 10], [7, 10, 6],// top mid-tail
    [4, 5, 9], [4, 9, 8],   // bottom mid-tail
    // nose cap
    [0, 3, 2], [0, 2, 1],
    // tail cap
    [8, 9, 10], [8, 10, 11],
];

// ── Tail boom ─────────────────────────────────────────────────────────────
const boomVerts = [
    [-0.05, -0.9, 0.05], [0.05, -0.9, 0.05],
    [0.05, -0.9, -0.02], [-0.05, -0.9, -0.02],
    [-0.04, -2.0, 0.04], [0.04, -2.0, 0.04],
    [0.04, -2.0, -0.01], [-0.04, -2.0, -0.01],
];
const boomFaces = [
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];

// ── Tail rotor (thin disc approximation – 6-sided) ────────────────────────
const TAIL_ROTOR_R = 0.18;
const TAIL_ROTOR_CX = 0.14; // offset right
const TAIL_ROTOR_Y = -2.0;
const TAIL_ROTOR_Z = 0.08;
const tailRotorVerts = [];
const tailRotorFaces = [];
const TR_SEGS = 6;
tailRotorVerts.push([TAIL_ROTOR_CX, TAIL_ROTOR_Y, TAIL_ROTOR_Z]); // center idx 0
for (let i = 0; i < TR_SEGS; i++) {
    const a = (i / TR_SEGS) * Math.PI * 2;
    tailRotorVerts.push([
        TAIL_ROTOR_CX,
        TAIL_ROTOR_Y + Math.sin(a) * TAIL_ROTOR_R,
        TAIL_ROTOR_Z + Math.cos(a) * TAIL_ROTOR_R,
    ]);
}
for (let i = 0; i < TR_SEGS; i++) {
    tailRotorFaces.push([0, i + 1, ((i + 1) % TR_SEGS) + 1]);
}

// ── Main rotor blades (4 thin quads on XY plane, above fuselage) ──────────
const ROTOR_Z = 0.5;
const ROTOR_R = 1.0;
const ROTOR_W = 0.05;
const mainRotorVerts = [];
const mainRotorFaces = [];
const BLADES = 4;
for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2;
    const bv = mainRotorVerts.length;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    const px = -Math.sin(a) * ROTOR_W;
    const py = Math.cos(a) * ROTOR_W;
    mainRotorVerts.push(
        [px, py, ROTOR_Z],
        [-px, -py, ROTOR_Z],
        [cx * ROTOR_R - px, cy * ROTOR_R - py, ROTOR_Z],
        [cx * ROTOR_R + px, cy * ROTOR_R + py, ROTOR_Z],
    );
    mainRotorFaces.push([bv, bv + 1, bv + 2], [bv, bv + 2, bv + 3]);
}

// ── Skids (landing gear) ──────────────────────────────────────────────────
const SKID_Y_OFFSET = 0.45;
const SKID_Z = -0.28;
const SKID_H = 0.06;
const SKID_R = 0.03;
function makeSkid(xOff) {
    const v = [
        [xOff - SKID_R, -SKID_Y_OFFSET, SKID_Z],
        [xOff + SKID_R, -SKID_Y_OFFSET, SKID_Z],
        [xOff + SKID_R, SKID_Y_OFFSET, SKID_Z],
        [xOff - SKID_R, SKID_Y_OFFSET, SKID_Z],
        [xOff - SKID_R, -SKID_Y_OFFSET, SKID_Z + SKID_H],
        [xOff + SKID_R, -SKID_Y_OFFSET, SKID_Z + SKID_H],
        [xOff + SKID_R, SKID_Y_OFFSET, SKID_Z + SKID_H],
        [xOff - SKID_R, SKID_Y_OFFSET, SKID_Z + SKID_H],
    ];
    const f = [
        [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
        [4, 5, 6], [4, 6, 7],
    ];
    return { v, f };
}
const leftSkid = makeSkid(-0.35);
const rightSkid = makeSkid(0.35);

// ---------------------------------------------------------------------------
// Merge all parts into a single mesh
// ---------------------------------------------------------------------------
function mergeParts(parts) {
    const allVerts = [];
    const allFaces = [];
    parts.forEach(({ verts, faces }) => {
        const offset = allVerts.length;
        allVerts.push(...verts);
        allFaces.push(...faces.map(([a, b, c]) => [a + offset, b + offset, c + offset]));
    });
    return { allVerts, allFaces };
}

const { allVerts, allFaces } = mergeParts([
    { verts: fuselageVerts, faces: fuselageFaces },
    { verts: boomVerts, faces: boomFaces },
    { verts: tailRotorVerts, faces: tailRotorFaces },
    { verts: mainRotorVerts, faces: mainRotorFaces },
    { verts: leftSkid.v, faces: leftSkid.f },
    { verts: rightSkid.v, faces: rightSkid.f },
]);

const posF32 = packF32(allVerts);
const idxU16 = packU16(allFaces);

// Pad to 4-byte alignment
function pad4(buf) {
    const rem = buf.byteLength % 4;
    if (rem === 0) return buf;
    const padded = new Uint8Array(buf.byteLength + (4 - rem));
    padded.set(new Uint8Array(buf.buffer || buf));
    return padded;
}

const posBytes = pad4(new Uint8Array(posF32.buffer));
const idxBytes = pad4(new Uint8Array(idxU16.buffer));

// Bounding box
const xs = allVerts.map(v => v[0]);
const ys = allVerts.map(v => v[1]);
const zs = allVerts.map(v => v[2]);
const min = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
const max = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];

// ---------------------------------------------------------------------------
// Build glTF JSON
// ---------------------------------------------------------------------------
const bv0Offset = 0;
const bv1Offset = posBytes.byteLength;
const binLength = posBytes.byteLength + idxBytes.byteLength;

const gltf = {
    asset: { version: "2.0", generator: "aeris-mercosul-script" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
        primitives: [{
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0,
        }],
    }],
    materials: [{
        pbrMetallicRoughness: {
            baseColorFactor: [0.55, 0.60, 0.65, 1.0], // muted steel-grey
            metallicFactor: 0.4,
            roughnessFactor: 0.6,
        },
        name: "helicopter-body",
    }],
    accessors: [
        {
            bufferView: 0,
            componentType: 5126, // FLOAT
            count: allVerts.length,
            type: "VEC3",
            min,
            max,
        },
        {
            bufferView: 1,
            componentType: 5123, // UNSIGNED_SHORT
            count: allFaces.length * 3,
            type: "SCALAR",
        },
    ],
    bufferViews: [
        { buffer: 0, byteOffset: bv0Offset, byteLength: posF32.byteLength, target: 34962 },
        { buffer: 0, byteOffset: bv1Offset, byteLength: idxU16.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
};

// ---------------------------------------------------------------------------
// Pack GLB
// ---------------------------------------------------------------------------
const jsonStr = JSON.stringify(gltf);
const jsonBytes = Buffer.from(jsonStr, "utf8");
// JSON chunk must be padded to 4 bytes with spaces (0x20)
const jsonPadLen = (4 - (jsonBytes.length % 4)) % 4;
const jsonChunkData = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadLen, 0x20)]);

const binChunkData = Buffer.concat([
    Buffer.from(posBytes.buffer || posBytes),
    Buffer.from(idxBytes.buffer || idxBytes),
]);

const totalLength =
    12 +                           // GLB header
    8 + jsonChunkData.length +     // JSON chunk header + data
    8 + binChunkData.length;       // BIN chunk header + data

const glb = Buffer.alloc(totalLength);
let offset = 0;

// GLB header
glb.writeUInt32LE(0x46546c67, offset); offset += 4; // magic 'glTF'
glb.writeUInt32LE(2, offset); offset += 4;           // version
glb.writeUInt32LE(totalLength, offset); offset += 4;

// JSON chunk
glb.writeUInt32LE(jsonChunkData.length, offset); offset += 4;
glb.writeUInt32LE(0x4e4f534a, offset); offset += 4; // type 'JSON'
jsonChunkData.copy(glb, offset); offset += jsonChunkData.length;

// BIN chunk
glb.writeUInt32LE(binChunkData.length, offset); offset += 4;
glb.writeUInt32LE(0x004e4942, offset); offset += 4; // type 'BIN\0'
binChunkData.copy(glb, offset);

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
const outPath = path.join(__dirname, "..", "public", "models", "helicopter.glb");
fs.writeFileSync(outPath, glb);
console.log(`✅ helicopter.glb written (${glb.length} bytes, ${allVerts.length} verts, ${allFaces.length} tris)`);

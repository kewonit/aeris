// ── Category Styling ───────────────────────────────────────────────────

import {
  MODEL_KEY_WINGSPAN,
  resolveModelKey,
  wingspanToDisplayScale,
} from "./aircraft-model-mapping";

export const CATEGORY_TINT: Record<number, [number, number, number]> = {
  2: [100, 235, 180],
  3: [120, 225, 235],
  4: [255, 210, 120],
  5: [255, 185, 110],
  6: [255, 160, 120],
  7: [255, 120, 200],
  8: [140, 220, 160],
  9: [170, 210, 255],
  10: [220, 170, 255],
  11: [255, 150, 180],
  12: [180, 230, 160],
  14: [195, 165, 255],
};

// ── Wingspan-Based Aircraft Size Multiplier ────────────────────────────
//
// Maps aircraft to a 2D icon size multiplier based on real wingspan data
// (ICAO Doc 8643 / manufacturer specs). Uses typeCode for precision,
// then model-key class wingspan as fallback, then emitter category.
//
// Range: 0.65 (small UAV, ~5m) → 1.30 (A380, ~80m).
// Linear: mult = 0.65 + clamp((wingspan - 5) / 75, 0, 1) * 0.65
//
// At base icon size 20px:
//   Cessna 172: 14px  |  CRJ-200: 16px  |  A320: 18px
//   B767: 20px        |  B787: 21px      |  B777: 23px
//   A380: 26px
//
// This gives ~86% more range than the old category-only system (0.82–1.12).

// Fine-grained wingspan overrides for types where intra-class
// differentiation matters. Values from manufacturer specs (metres).
const TYPE_WINGSPAN_OVERRIDE: Readonly<Record<string, number>> = {
  // ── Boeing 757 (narrowbody model, wider than B737/A320) ──────────
  B752: 38,
  B753: 38,
  // ── Boeing 767 (widebody-2eng but smaller than B777) ─────────────
  B762: 48,
  B763: 48,
  B764: 52,
  // ── Boeing 787 ───────────────────────────────────────────────────
  B788: 60,
  B789: 60,
  B78X: 60,
  // ── Boeing 777 ───────────────────────────────────────────────────
  B772: 61,
  B773: 61,
  B77L: 65,
  B77W: 65,
  B778: 72,
  B779: 72,
  // ── Boeing 747 ───────────────────────────────────────────────────
  B741: 60,
  B742: 60,
  B743: 60,
  B744: 64,
  B748: 68,
  B74S: 60,
  // ── Airbus widebodies ────────────────────────────────────────────
  A30B: 45,
  A306: 45,
  A310: 44,
  A332: 60,
  A333: 60,
  A338: 64,
  A339: 64,
  A342: 60,
  A343: 60,
  A345: 64,
  A346: 64,
  A359: 65,
  A35K: 65,
  // ── Regional jets — CRJ vs Embraer ───────────────────────────────
  CRJ1: 21,
  CRJ2: 21,
  CRJ7: 23,
  CRJ9: 25,
  CRJX: 26,
  E170: 26,
  E75S: 26,
  E75L: 26,
  E190: 29,
  E195: 29,
  E290: 34,
  E295: 35,
  E135: 20,
  E145: 20,
  E35L: 20,
  E45X: 20,
  // ── Turboprops ───────────────────────────────────────────────────
  DH8D: 28,
  AT76: 27,
  AT72: 27,
  DH8A: 26,
  DH8B: 26,
  DH8C: 27,
  AT43: 25,
  AT45: 25,
  SF34: 21,
  JS41: 18,
  // ── Larger business jets ─────────────────────────────────────────
  GLEX: 29,
  GL5T: 29,
  GL7T: 30,
  GLF5: 29,
  GLF6: 30,
  // ── Smaller business jets ────────────────────────────────────────
  LJ35: 12,
  LJ45: 15,
  LJ60: 13,
  C56X: 16,
  C560: 16,
  C680: 19,
  C68A: 22,
  C700: 20,
  E55P: 16,
  E50P: 12,
  // ── Russian / military widebodies ────────────────────────────────
  IL76: 51,
  IL96: 60,
  A124: 73,
  AN22: 64,
  C17: 52,
  C5M: 68,
  KC10: 50,
  K35R: 40,
};

/**
 * Returns a 2D icon size multiplier for an aircraft based on its real
 * wingspan. Uses typeCode for precision, model-key class wingspan as
 * fallback, then emitter category as last resort.
 */
export function aircraftSizeMultiplier(
  typeCode: string | null | undefined,
  category: number | null,
): number {
  if (typeCode) {
    const upper = typeCode.toUpperCase();
    const override = TYPE_WINGSPAN_OVERRIDE[upper];
    if (override !== undefined) return wingspanToDisplayScale(override);
  }

  const modelKey = resolveModelKey(category, typeCode);
  return wingspanToDisplayScale(MODEL_KEY_WINGSPAN[modelKey]);
}

export function tintAircraftColor(
  base: [number, number, number, number],
  category: number | null,
): [number, number, number, number] {
  const tint = category !== null ? CATEGORY_TINT[category] : undefined;
  if (!tint) return base;

  return [
    Math.round(base[0] * 0.58 + tint[0] * 0.42),
    Math.round(base[1] * 0.58 + tint[1] * 0.42),
    Math.round(base[2] * 0.58 + tint[2] * 0.42),
    base[3],
  ];
}

/** Apply military (amber) or emergency (red) tint on top of normal color. */
export function applySpecialTint(
  color: [number, number, number, number],
  dbFlags?: number | null,
  emergencyStatus?: string | null,
): [number, number, number, number] {
  // Emergency overrides military
  if (emergencyStatus && emergencyStatus !== "none") {
    return [
      Math.round(color[0] * 0.3 + 255 * 0.7),
      Math.round(color[1] * 0.3 + 60 * 0.7),
      Math.round(color[2] * 0.3 + 60 * 0.7),
      color[3],
    ];
  }
  if (((dbFlags ?? 0) & 1) !== 0) {
    return [
      Math.round(color[0] * 0.4 + 255 * 0.6),
      Math.round(color[1] * 0.4 + 190 * 0.6),
      Math.round(color[2] * 0.4 + 80 * 0.6),
      color[3],
    ];
  }
  return color;
}

// ── Selection pulse timing ─────────────────────────────────────────────

export const PULSE_PERIOD_MS = 14_000;

// ── Canvas Atlas Generators ────────────────────────────────────────────

export function createHaloAtlas(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  for (let r = 0; r < c; r++) {
    const norm = r / c;
    let alpha = 0;
    if (norm < 0.4) {
      // Large clear center — no glow within ~40% of radius so it never
      // overlaps the aircraft icon even at the largest category size.
      alpha = 0;
    } else if (norm < 0.55) {
      const t = (norm - 0.4) / 0.15;
      alpha = t * t * 0.4;
    } else if (norm < 0.72) {
      alpha = 0.4 - ((norm - 0.55) / 0.17) * 0.15;
    } else {
      const t = (norm - 0.72) / 0.28;
      alpha = 0.25 * (1 - t) * (1 - t);
    }
    if (alpha < 0.003) continue;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

export function createSoftRingAtlas(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const ringCenter = c * 0.75;
  const ringWidth = c * 0.18;
  for (let r = 0; r < c; r++) {
    const dist = Math.abs(r - ringCenter);
    const falloff = Math.max(0, 1 - (dist / ringWidth) ** 2);
    const alpha = falloff * 0.85;
    if (alpha < 0.005) continue;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

export function createAircraftAtlas(): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";

  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.lineTo(71, 19);
  ctx.lineTo(71, 33);
  ctx.lineTo(100, 44);
  ctx.lineTo(106, 52);
  ctx.lineTo(80, 53);
  ctx.lineTo(72, 56);
  ctx.lineTo(72, 88);
  ctx.lineTo(90, 101);
  ctx.lineTo(88, 108);
  ctx.lineTo(69, 99);
  ctx.lineTo(69, 121);
  ctx.lineTo(64, 126);
  ctx.lineTo(59, 121);
  ctx.lineTo(59, 99);
  ctx.lineTo(40, 108);
  ctx.lineTo(38, 101);
  ctx.lineTo(56, 88);
  ctx.lineTo(56, 56);
  ctx.lineTo(48, 53);
  ctx.lineTo(22, 52);
  ctx.lineTo(28, 44);
  ctx.lineTo(57, 33);
  ctx.lineTo(57, 19);
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(64, 13);
  ctx.lineTo(67, 19);
  ctx.lineTo(64, 24);
  ctx.lineTo(61, 19);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  return canvas;
}

// ── Icon Mappings ──────────────────────────────────────────────────────

export const HALO_MAPPING = {
  halo: {
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    anchorX: 128,
    anchorY: 128,
    mask: true,
  },
};

export const RING_MAPPING = {
  ring: {
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    anchorX: 128,
    anchorY: 128,
    mask: true,
  },
};

export const AIRCRAFT_ICON_MAPPING = {
  aircraft: {
    x: 0,
    y: 0,
    width: 128,
    height: 128,
    anchorX: 64,
    anchorY: 64,
    mask: true,
  },
};

// ── Cached Atlas Data URLs ─────────────────────────────────────────────

let _haloCache: string | undefined;
export function getHaloUrl(): string {
  if (typeof document === "undefined") return "";
  if (!_haloCache) _haloCache = createHaloAtlas().toDataURL();
  return _haloCache;
}

let _ringCache: string | undefined;
export function getRingUrl(): string {
  if (typeof document === "undefined") return "";
  if (!_ringCache) _ringCache = createSoftRingAtlas().toDataURL();
  return _ringCache;
}

let _atlasCache: string | undefined;
export function getAircraftAtlasUrl(): string {
  if (typeof document === "undefined") return "";
  if (!_atlasCache) _atlasCache = createAircraftAtlas().toDataURL();
  return _atlasCache;
}

// ── Category Styling ───────────────────────────────────────────────────

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

export function categorySizeMultiplier(category: number | null): number {
  switch (category) {
    case 2:
      return 0.92;
    case 3:
      return 0.96;
    case 4:
      return 1.04;
    case 5:
      return 1.08;
    case 6:
      return 1.12;
    case 7:
      return 1.0;
    case 8:
      return 0.9;
    case 9:
    case 12:
      return 0.86;
    case 10:
      return 1.06;
    case 14:
      return 0.82;
    default:
      return 1;
  }
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

// ── Selection pulse timing ─────────────────────────────────────────────

export const PULSE_PERIOD_MS = 7000;
export const RING_PERIOD_MS = 5500;

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
    if (norm < 0.18) {
      alpha = 0;
    } else if (norm < 0.35) {
      const t = (norm - 0.18) / 0.17;
      alpha = t * t * 0.7;
    } else if (norm < 0.55) {
      alpha = 0.7 - ((norm - 0.35) / 0.2) * 0.3;
    } else {
      const t = (norm - 0.55) / 0.45;
      alpha = 0.4 * (1 - t) * (1 - t);
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

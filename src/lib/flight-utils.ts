
const MAX_ALTITUDE_METERS = 13000;

/** EMA alpha for MLAT position smoothing. MLAT accuracy (~100m) is 10x
 *  worse than ADS-B (~10m), so we blend toward the previous position to
 *  suppress jitter. 0.65 retains responsiveness while cutting noise. The
 *  map and the trail store both apply it, so trails meet the aircraft. */
export const MLAT_POSITION_ALPHA = 0.65;

type RGB = [number, number, number];

/**
 * The altitude ramp runs from green near the ground through yellow, orange,
 * pink and violet to blue at cruise, as it always has. Its hues come from
 * the old stops; its lightness is set per map instead of left to the hues,
 * which made cruise the dimmest band on dark maps and low traffic the
 * faintest on light ones. On a dark map lightness rises with height; on a
 * light map every height is dark enough to stand 3:1 against the page.
 */
const HUE_STOPS: { t: number; hue: number }[] = [
  { t: 0.0, hue: 165.1 },
  { t: 0.1, hue: 148.4 },
  { t: 0.2, hue: 124.1 },
  { t: 0.3, hue: 94.7 },
  { t: 0.4, hue: 63.4 },
  { t: 0.52, hue: 34.3 },
  { t: 0.64, hue: 2.7 },
  { t: 0.76, hue: -36.5 },
  { t: 0.88, hue: -75.5 },
  { t: 1.0, hue: -110.1 },
];

const RAMP_THEMES = {
  dark: { lightness: [0.72, 0.84], chroma: 0.15 },
  light: { lightness: [0.5, 0.58], chroma: 0.16 },
} as const;

export type AltitudeTheme = keyof typeof RAMP_THEMES;

const LUT_SIZE = 64;

function hueAt(t: number): number {
  for (let i = 0; i < HUE_STOPS.length - 1; i++) {
    const a = HUE_STOPS[i];
    const b = HUE_STOPS[i + 1];
    if (t <= b.t) return a.hue + ((b.hue - a.hue) * (t - a.t)) / (b.t - a.t);
  }
  return HUE_STOPS[HUE_STOPS.length - 1].hue;
}

function toSrgbChannel(linear: number): number {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return v * 255;
}

/** OKLCH to sRGB, or null when the colour lies outside sRGB. */
function oklchToRgb(l: number, c: number, hueDeg: number): RGB | null {
  const h = (hueDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  if (linear.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  return linear.map((v) => Math.round(Math.min(255, Math.max(0, toSrgbChannel(v))))) as RGB;
}

/** The colour at a lightness and hue, giving up chroma until it fits sRGB. */
function inGamut(l: number, chroma: number, hue: number): RGB {
  let lo = 0;
  let hi = chroma;
  let best = oklchToRgb(l, 0, hue)!;
  const full = oklchToRgb(l, chroma, hue);
  if (full) return full;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const rgb = oklchToRgb(l, mid, hue);
    if (rgb) {
      best = rgb;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function buildRamp(theme: AltitudeTheme): RGB[] {
  const { lightness, chroma } = RAMP_THEMES[theme];
  return Array.from({ length: LUT_SIZE }, (_, i) => {
    const t = i / (LUT_SIZE - 1);
    const l = lightness[0] + (lightness[1] - lightness[0]) * t;
    return inGamut(l, chroma, hueAt(t));
  });
}

const RAMPS: Record<AltitudeTheme, RGB[]> = {
  dark: buildRamp("dark"),
  light: buildRamp("light"),
};

let currentTheme: AltitudeTheme = "dark";

/**
 * Picks the ramp for the map in view. Layers that cache colours include
 * altitudeThemeKey() in their keys so a change redraws them.
 */
export function setAltitudeTheme(theme: AltitudeTheme): void {
  currentTheme = theme;
}

export function altitudeThemeKey(): AltitudeTheme {
  return currentTheme;
}

/** The ramp itself, low to high, for the legend and for tests. */
export function altitudeRamp(theme: AltitudeTheme = currentTheme): readonly RGB[] {
  return RAMPS[theme];
}

/** Where an altitude falls on the ramp, 0 to 1. Low heights get more room. */
export function altitudeRampPosition(altitude: number): number {
  const normalized = Math.min(Math.max(altitude / MAX_ALTITUDE_METERS, 0), 1);
  return Math.pow(normalized, 0.4);
}

export function altitudeToColor(
  altitude: number | null,
): [number, number, number, number] {
  if (altitude === null || !Number.isFinite(altitude))
    return [100, 100, 100, 200];
  const ramp = RAMPS[currentTheme];
  const [r, g, b] = ramp[Math.round(altitudeRampPosition(altitude) * (LUT_SIZE - 1))];
  return [r, g, b, 210];
}

/** The highest altitude the ramp tells apart, in metres. */
export const ALTITUDE_RAMP_TOP_METERS = MAX_ALTITUDE_METERS;

export function formatCallsign(callsign: string | null): string {
  if (!callsign) return "N/A";
  return callsign.trim().toUpperCase();
}

export function headingToCardinal(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees)) return "-";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = ((Math.round(degrees / 45) % 8) + 8) % 8;
  return directions[index];
}

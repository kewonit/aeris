import type { UnitSystem } from "@/hooks/use-settings";
import {
  formatAltitude,
  formatVisibility,
  speedValueFromKnots,
} from "@/lib/unit-formatters";

/** The parts of a NOAA METAR the summary reads. */
export type MetarSummaryInput = {
  wxString?: string | null;
  /** Statute miles, or a string such as "10+". */
  visib?: number | string;
  wgst?: number;
  /** Cloud bases in feet above the airport. */
  clouds?: { cover: string; base?: number }[];
};

const FEET_TO_METERS = 0.3048;
/** Below about 5 km, visibility is worth a mention. */
const LOW_VISIBILITY_SM = 3;
/** A ceiling under this keeps arrivals on instruments. */
const LOW_CEILING_FT = 1_000;
const STRONG_GUST_KT = 25;

const PHENOMENA: Record<string, string> = {
  RA: "rain",
  DZ: "drizzle",
  SN: "snow",
  SG: "snow grains",
  IC: "ice crystals",
  PL: "ice pellets",
  GR: "hail",
  GS: "small hail",
  UP: "precipitation",
  BR: "mist",
  FG: "fog",
  FU: "smoke",
  VA: "volcanic ash",
  DU: "dust",
  SA: "sand",
  HZ: "haze",
  PY: "spray",
  PO: "dust whirls",
  SQ: "squalls",
  FC: "funnel cloud",
  SS: "sandstorm",
  DS: "duststorm",
};

/** Haze and mist alone are only worth a word when visibility is low. */
const QUIET_PHENOMENA = new Set(["haze", "mist"]);

/** One METAR weather group, such as "-SHRA" or "+TSRA", in words. */
export function describeWeatherGroup(group: string): string | null {
  let rest = group.trim().toUpperCase();
  if (!rest) return null;

  let intensity = "";
  if (rest.startsWith("+")) {
    intensity = "heavy";
    rest = rest.slice(1);
  } else if (rest.startsWith("-")) {
    intensity = "light";
    rest = rest.slice(1);
  }
  let nearby = false;
  if (rest.startsWith("VC")) {
    nearby = true;
    rest = rest.slice(2);
  }

  const descriptors: string[] = [];
  for (const code of ["MI", "PR", "BC", "DR", "BL", "SH", "TS", "FZ"]) {
    if (rest.startsWith(code)) {
      descriptors.push(code);
      rest = rest.slice(2);
    }
  }

  const phenomena: string[] = [];
  while (rest.length >= 2) {
    const word = PHENOMENA[rest.slice(0, 2)];
    if (word) phenomena.push(word);
    rest = rest.slice(2);
  }

  const parts: string[] = [];
  if (descriptors.includes("TS")) parts.push("thunderstorms");
  if (phenomena.length) {
    let base = phenomena.join(" and ");
    if (descriptors.includes("FZ")) base = `freezing ${base}`;
    if (descriptors.includes("BL")) base = `blowing ${base}`;
    if (descriptors.includes("DR")) base = `drifting ${base}`;
    if (descriptors.includes("SH")) base = `${base} showers`;
    if (intensity) base = `${intensity} ${base}`;
    parts.push(base);
  } else if (descriptors.includes("SH")) {
    parts.push(intensity ? `${intensity} showers` : "showers");
  }
  if (!parts.length) return null;
  const text = parts.join(" with ");
  return nearby ? `${text} nearby` : text;
}

function visibilityMiles(visib: number | string | undefined): number | null {
  if (typeof visib === "number") return Number.isFinite(visib) ? visib : null;
  if (typeof visib !== "string") return null;
  const parsed = Number.parseFloat(visib);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The lowest broken or overcast layer, in feet. */
function ceilingFeet(clouds: MetarSummaryInput["clouds"]): number | null {
  let lowest: number | null = null;
  for (const layer of clouds ?? []) {
    if (!["BKN", "OVC", "OVX", "VV"].includes(layer.cover.toUpperCase())) continue;
    if (layer.base == null || !Number.isFinite(layer.base)) continue;
    if (lowest === null || layer.base < lowest) lowest = layer.base;
  }
  return lowest;
}

/**
 * The weather at an airport worth telling someone about, as
 * "BOM: heavy rain, visibility 2 km", or null when it is unremarkable.
 */
export function describeNotableWeather(
  code: string,
  metar: MetarSummaryInput | null | undefined,
  units: UnitSystem,
): string | null {
  if (!metar) return null;
  const miles = visibilityMiles(metar.visib);
  const lowVisibility = miles !== null && miles < LOW_VISIBILITY_SM;

  const parts: string[] = [];
  for (const group of (metar.wxString ?? "").split(/\s+/)) {
    const words = describeWeatherGroup(group);
    if (!words) continue;
    if (QUIET_PHENOMENA.has(words) && !lowVisibility) continue;
    if (!parts.includes(words)) parts.push(words);
  }

  if (lowVisibility) {
    parts.push(`visibility ${formatVisibility(metar.visib, units)}`);
  }

  const ceiling = ceilingFeet(metar.clouds);
  if (ceiling !== null && ceiling < LOW_CEILING_FT) {
    parts.push(`cloud at ${formatAltitude(ceiling * FEET_TO_METERS, units)}`);
  }

  if (metar.wgst != null && metar.wgst >= STRONG_GUST_KT) {
    const gust = speedValueFromKnots(metar.wgst, units);
    const unit = units === "metric" ? "km/h" : units === "imperial" ? "mph" : "kt";
    parts.push(`gusts ${gust} ${unit}`);
  }

  if (!parts.length) return null;
  return `${code}: ${parts.join(", ")}`;
}

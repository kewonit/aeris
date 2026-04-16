import type { UnitSystem } from "@/hooks/use-settings";

const FT_PER_METER = 3.28084;
const KTS_PER_MS = 1.94384;
const FPM_PER_MS = 196.850394;
const KM_PER_NM = 1.852;
const MI_PER_NM = 1.15078;
const MPH_PER_MS = 2.23694;
const KMH_PER_MS = 3.6;
const INHG_PER_HPA = 0.0295299830714;

export function altitudeValueFromMeters(
  meters: number | null,
  unitSystem: UnitSystem,
): number | null {
  if (meters === null || !Number.isFinite(meters)) return null;
  if (unitSystem === "metric") return Math.round(meters);
  return Math.round(meters * FT_PER_METER);
}

export function altitudeValueFromFeet(
  feet: number | null | undefined,
  unitSystem: UnitSystem,
): number | null {
  if (feet == null || !Number.isFinite(feet)) return null;
  if (unitSystem === "metric") return Math.round(feet / FT_PER_METER);
  return Math.round(feet);
}

export function speedValueFromMs(
  ms: number | null,
  unitSystem: UnitSystem,
): number | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  if (unitSystem === "metric") return Math.round(ms * KMH_PER_MS);
  if (unitSystem === "imperial") return Math.round(ms * MPH_PER_MS);
  return Math.round(ms * KTS_PER_MS);
}

export function speedValueFromKnots(
  knots: number | null | undefined,
  unitSystem: UnitSystem,
): number | null {
  if (knots == null || !Number.isFinite(knots)) return null;
  if (unitSystem === "metric") return Math.round(knots * KM_PER_NM);
  if (unitSystem === "imperial") return Math.round(knots * MI_PER_NM);
  return Math.round(knots);
}

export function formatAltitude(
  meters: number | null,
  unitSystem: UnitSystem,
): string {
  if (meters === null || !Number.isFinite(meters)) return "—";
  if (unitSystem === "metric") {
    return `${Math.round(meters).toLocaleString()} m`;
  }
  return `${Math.round(meters * FT_PER_METER).toLocaleString()} ft`;
}

export function formatSpeed(
  ms: number | null,
  unitSystem: UnitSystem,
): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (unitSystem === "metric") {
    return `${Math.round(ms * KMH_PER_MS).toLocaleString()} km/h`;
  }
  if (unitSystem === "imperial") {
    return `${Math.round(ms * MPH_PER_MS).toLocaleString()} mph`;
  }
  return `${Math.round(ms * KTS_PER_MS).toLocaleString()} kts`;
}

export function formatVerticalSpeed(
  ms: number | null,
  unitSystem: UnitSystem,
): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (unitSystem === "metric") {
    return `${ms > 0 ? "+" : ""}${ms.toFixed(1)} m/s`;
  }
  const fpm = Math.round(ms * FPM_PER_MS);
  return `${fpm > 0 ? "+" : ""}${fpm.toLocaleString()} fpm`;
}

export function formatVerticalSpeedValue(
  ms: number | null,
  unitSystem: UnitSystem,
): { value: number | null; unitLabel: string; text: string } {
  if (ms === null || !Number.isFinite(ms)) {
    return {
      value: null,
      unitLabel: unitSystem === "metric" ? "m/s" : "fpm",
      text: "—",
    };
  }

  if (unitSystem === "metric") {
    const rounded = Math.round(ms * 10) / 10;
    return {
      value: rounded,
      unitLabel: "m/s",
      text: `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`,
    };
  }

  const fpm = Math.round(ms * FPM_PER_MS);
  return {
    value: fpm,
    unitLabel: "fpm",
    text: `${fpm > 0 ? "+" : ""}${fpm.toLocaleString()}`,
  };
}

export function formatDistanceNm(
  nm: number,
  unitSystem: UnitSystem,
): string {
  if (!Number.isFinite(nm)) return "—";
  if (unitSystem === "metric") {
    const km = nm * KM_PER_NM;
    if (km < 0.1) return "<0.1 km";
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km).toLocaleString()} km`;
  }
  if (unitSystem === "imperial") {
    const mi = nm * MI_PER_NM;
    if (mi < 0.1) return "<0.1 mi";
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi).toLocaleString()} mi`;
  }
  if (nm < 0.1) return "<0.1 nm";
  if (nm < 10) return `${nm.toFixed(1)} nm`;
  return `${Math.round(nm).toLocaleString()} nm`;
}

export function formatDistanceAxisNm(
  nm: number,
  unitSystem: UnitSystem,
): string {
  if (!Number.isFinite(nm)) return "—";
  if (unitSystem === "metric") return `${Math.round(nm * KM_PER_NM)} km`;
  if (unitSystem === "imperial") return `${Math.round(nm * MI_PER_NM)} mi`;
  return `${Math.round(nm)} nm`;
}

export function formatTemperatureC(
  celsius: number | null | undefined,
  unitSystem: UnitSystem,
): string {
  if (celsius == null || !Number.isFinite(celsius)) return "—";
  if (unitSystem === "imperial") {
    return `${Math.round((celsius * 9) / 5 + 32)}°F`;
  }
  return `${Math.round(celsius)}°C`;
}

export function formatPressureHpa(
  hpa: number | null | undefined,
  unitSystem: UnitSystem,
): string {
  if (hpa == null || !Number.isFinite(hpa)) return "—";
  if (unitSystem === "imperial") {
    return `${(hpa * INHG_PER_HPA).toFixed(2)} inHg`;
  }
  return `${hpa.toFixed(0)} hPa`;
}

export function formatVisibility(
  vis: number | string | undefined,
  unitSystem: UnitSystem,
): string {
  if (vis === undefined || vis === null) return "—";
  if (typeof vis === "string") return vis;
  if (unitSystem === "metric") {
    if (vis >= 9999) return "16+ km";
    return `${Math.round(vis * 1.60934)} km`;
  }
  if (vis >= 9999) return "10+ SM";
  return `${vis} SM`;
}

export function formatWindFromKnots(
  direction: number | string | undefined,
  speedKt: number | undefined,
  gustKt: number | undefined,
  unitSystem: UnitSystem,
): string {
  if (speedKt === undefined) return "Calm";

  const speed = speedValueFromKnots(speedKt, unitSystem);
  const gust = speedValueFromKnots(gustKt, unitSystem);
  const unitLabel =
    unitSystem === "metric"
      ? "km/h"
      : unitSystem === "imperial"
        ? "mph"
        : "kt";

  return `${direction ?? "VRB"}° ${speed}${unitLabel}${gust === null ? "" : ` G${gust}`}`;
}

export function formatCloudBaseHundredsFeet(
  baseHundredsFeet: number | null | undefined,
  unitSystem: UnitSystem,
): string {
  if (baseHundredsFeet == null || !Number.isFinite(baseHundredsFeet)) return "";
  const feet = baseHundredsFeet * 100;
  if (unitSystem === "metric") {
    return ` ${Math.round(feet / FT_PER_METER).toLocaleString()}m`;
  }
  return ` ${feet.toLocaleString()}ft`;
}

export function altitudeUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === "metric" ? "m" : "ft";
}

export function speedUnitLabel(unitSystem: UnitSystem): string {
  if (unitSystem === "metric") return "km/h";
  if (unitSystem === "imperial") return "mph";
  return "kts";
}

export function verticalSpeedUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === "metric" ? "m/s" : "fpm";
}

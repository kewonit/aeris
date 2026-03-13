// ── Aircraft Model Mapping ─────────────────────────────────────────────
//
// Maps ADS-B category + ICAO typeCode → 3D model silhouette.
// Each model key corresponds to a GLB file in public/models/aircraft/.
//
// Category-based fallback assigns generic silhouettes (narrowbody, etc.).
// TypeCode-based matching routes iconic types (A380, B737) to dedicated models.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "@/lib/opensky";

// ── Model Keys ─────────────────────────────────────────────────────────

export type AircraftModelKey =
  | "a380"
  | "b737"
  | "narrowbody"
  | "widebody-2eng"
  | "widebody-4eng"
  | "regional-jet"
  | "light-prop"
  | "turboprop"
  | "helicopter"
  | "bizjet"
  | "glider"
  | "fighter"
  | "drone"
  | "generic";

export const ALL_MODEL_KEYS: readonly AircraftModelKey[] = [
  "a380",
  "b737",
  "narrowbody",
  "widebody-2eng",
  "widebody-4eng",
  "regional-jet",
  "light-prop",
  "turboprop",
  "helicopter",
  "bizjet",
  "glider",
  "fighter",
  "drone",
  "generic",
] as const;

// ── URL Resolution ─────────────────────────────────────────────────────

const MODEL_BASE_PATH = "/models/aircraft";

const MODEL_VERSION = 5;

// A380 reuses the widebody-4eng mesh (it IS the A380 from FlightAirMap).
const MODEL_URL_OVERRIDES: Partial<Record<AircraftModelKey, string>> = {
  a380: "widebody-4eng",
};

export function modelUrl(key: AircraftModelKey): string {
  const file = MODEL_URL_OVERRIDES[key] ?? key;
  return `${MODEL_BASE_PATH}/${file}.glb?v=${MODEL_VERSION}`;
}

// ── Per-Model Size Normalization ───────────────────────────────────────
//
// Factors normalize all models to a consistent visual base (~40 units).
// categorySizeMultiplier in aircraft-appearance.ts adds per-category scaling.

const MODEL_NORMALIZE: Readonly<Record<AircraftModelKey, number>> = {
  a380: 0.42,
  b737: 0.55,
  narrowbody: 1.0,
  "widebody-2eng": 0.85,
  "widebody-4eng": 0.42,
  "regional-jet": 1.0,
  "light-prop": 2.8,
  turboprop: 0.9,
  helicopter: 2.2,
  bizjet: 2.2,
  glider: 2.0,
  fighter: 2.8,
  drone: 2.8,
  generic: 1.0,
};

/** Returns the size normalization factor for a model type */
export function modelNormScale(key: AircraftModelKey): number {
  return MODEL_NORMALIZE[key];
}

// ── Category → Model Key (DO-260B emitter categories) ──────────────────
export function categoryToModelKey(category: number | null): AircraftModelKey {
  switch (category) {
    case 2:
      return "light-prop";
    case 3:
      return "narrowbody";
    case 4:
      return "narrowbody";
    case 5:
      return "narrowbody";
    case 6:
      return "widebody-2eng";
    case 7:
      return "fighter";
    case 8:
      return "helicopter";
    case 9:
      return "glider";
    case 12:
      return "light-prop";
    case 14:
      return "drone";
    default:
      return "generic";
  }
}

// ── TypeCode → Model Key ───────────────────────────────────────────────

/** Maps ICAO type designator to a model key. Returns null for unrecognized types. */
export function typeCodeToModelKey(
  typeCode: string | null | undefined,
): AircraftModelKey | null {
  if (!typeCode) return null;
  const tc = typeCode.toUpperCase();

  // Airbus narrow-body (A318/A319/A320/A321/A320neo/A321neo)
  if (/^A3[12]\d/.test(tc) || /^A20N$|^A21N$/.test(tc)) return "narrowbody";

  // Airbus wide-body twin (A330/A350)
  if (/^A33\d$|^A35\d$/.test(tc)) return "widebody-2eng";

  // Airbus A380 — dedicated model
  if (/^A38\d$/.test(tc)) return "a380";

  // Airbus A340
  if (/^A34\d$/.test(tc)) return "widebody-4eng";

  // Boeing 737 family (incl. MAX) — dedicated model
  if (/^B73\d$|^B3[789]M$/.test(tc)) return "b737";

  // Boeing 757
  if (/^B75\d$/.test(tc)) return "narrowbody";

  // Boeing 767
  if (/^B76\d$/.test(tc)) return "widebody-2eng";

  // Boeing 777/787
  if (/^B77\d$|^B77[LW]$|^B78\d$|^B78X$/.test(tc)) return "widebody-2eng";

  // Boeing 747
  if (/^B74\d$|^B74F$/.test(tc)) return "widebody-4eng";

  // Regional jets (CRJ, Embraer E-Jets, Fokker)
  if (/^CRJ\d?$|^E[1279]\d{2}$|^F[17]0\d?$/.test(tc)) return "regional-jet";

  // Turboprops (ATR, Dash-8, Saab, etc.)
  if (/^AT[47]\d$|^DH8[A-D]?$|^SF34$|^JS[34]\d$/.test(tc)) return "turboprop";

  // Business jets
  if (
    /^GLF\d$|^CL\d{2}$|^FA\d{2}$|^LJ\d{2}$|^C[5-9]\d{2}$|^GA\d{2}$|^H25\d?$|^E[35]5\d$/.test(
      tc,
    )
  )
    return "bizjet";

  // Light GA aircraft (Cessna, Piper, Cirrus, Diamond, etc.)
  if (
    /^C[12]\d{2}$|^PA\d{2}$|^SR2\d$|^DA[24]\d$|^TB\d{2}$|^M20\d?$|^BE[3-9]\d$/.test(
      tc,
    )
  )
    return "light-prop";

  // Helicopters
  if (
    /^H[16]\d{2}$|^EC\d{2}$|^S[67]\d$|^R[24]\d$|^AS\d{2}$|^BK\d{2}$|^B[0-4]\d{2}$|^A[12]\d{2}$/.test(
      tc,
    )
  )
    return "helicopter";

  // Military fighters
  if (/^F\d{1,2}[A-Z]?$|^EF\d|^TOR$|^MIG\d|^SU\d/.test(tc)) return "fighter";

  return null;
}

// ── Combined Resolver ──────────────────────────────────────────────────

/** Resolves model key: typeCode match first, then category fallback. */
export function resolveModelKey(
  category: number | null,
  typeCode?: string | null,
): AircraftModelKey {
  if (typeCode) {
    const fromType = typeCodeToModelKey(typeCode);
    if (fromType) return fromType;
  }
  return categoryToModelKey(category);
}

// ── Flight Bucketing ───────────────────────────────────────────────────
export function bucketFlightsByModel(
  flights: FlightState[],
): Map<AircraftModelKey, FlightState[]> {
  const buckets = new Map<AircraftModelKey, FlightState[]>();

  for (const flight of flights) {
    const key = resolveModelKey(flight.category, flight.typeCode);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(flight);
    } else {
      buckets.set(key, [flight]);
    }
  }

  return buckets;
}

// ── Preloading ─────────────────────────────────────────────────────────

let preloaded = false;

const PREFETCH_KEYS: AircraftModelKey[] = [
  "generic",
  "narrowbody",
  "b737",
  "light-prop",
  "widebody-2eng",
  "turboprop",
  "helicopter",
];

export function preloadAllModels(): void {
  if (preloaded || typeof document === "undefined") return;
  preloaded = true;

  for (const key of PREFETCH_KEYS) {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = modelUrl(key);
    link.as = "fetch";
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}

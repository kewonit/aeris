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
// generic.glb and narrowbody.glb are identical files; drone.glb and light-prop.glb likewise.
const MODEL_URL_OVERRIDES: Partial<Record<AircraftModelKey, string>> = {
  a380: "widebody-4eng",
  generic: "narrowbody",
  drone: "light-prop",
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

// ── Per-Model Yaw Offset ───────────────────────────────────────────────
//
// Each GLB was authored/exported with a different nose direction in model space.
// These offsets rotate each model so that at yaw=0 the nose faces North.
// Combined formula: yaw = MODEL_YAW_OFFSET[key] - trueTrack
//
// Determined by analysing each model's node rotations and nose-indicator
// node translations (CockpitWindows, pilot_tubes, windscreen, etc.).

const MODEL_YAW_OFFSET: Readonly<Record<AircraftModelKey, number>> = {
  b737: 0, // no node rotation, nose at -Z → already faces North
  narrowbody: 90, // 180° Y rotation, nose raw +X → model +X → East at yaw=0
  generic: 90, // identical mesh to narrowbody
  "widebody-2eng": 180, // 90° Y rotation, nose raw +Z → model -X → South
  "widebody-4eng": 180, // same rotation family
  a380: 180, // uses widebody-4eng mesh
  "regional-jet": 180, // 90° Y rotation, nose indicators at +Z
  bizjet: 180, // 90° Y rotation, Glass.inside near +Z
  helicopter: 180, // 90° Y rotation, body extends +Z
  glider: 180, // 90° Y rotation, windowR near +Z
  fighter: 180, // 90° Y rotation
  turboprop: 180, // 120° diagonal rotation, cylinder at +Z
  "light-prop": 180, // 120° diagonal rotation
  drone: 180, // identical mesh to light-prop
};

/** Returns the yaw offset in degrees to orient the model's nose North */
export function modelYawOffset(key: AircraftModelKey): number {
  return MODEL_YAW_OFFSET[key];
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

// ── Per-Aircraft Model Key Cache ───────────────────────────────────────
//
// Avoids re-running up to 15 regex tests per flight per frame.
// Key = icao24, value = resolved model key.
// Cache is wiped when the flight data array changes (new poll).

const modelKeyCache = new Map<string, AircraftModelKey>();

/** Resolves model key with per-icao24 caching. */
export function resolveModelKeyCached(flight: FlightState): AircraftModelKey {
  const cached = modelKeyCache.get(flight.icao24);
  if (cached !== undefined) return cached;
  const key = resolveModelKey(flight.category, flight.typeCode);
  modelKeyCache.set(flight.icao24, key);
  return key;
}

/** Clear the model key cache when flight data changes. */
export function invalidateModelKeyCache(): void {
  modelKeyCache.clear();
}

// ── Flight Bucketing ───────────────────────────────────────────────────
//
// Cached bucketing: only recomputes when the flights array reference changes.
// This prevents 60fps re-bucketing + new array allocations that cause
// deck.gl to regenerate GPU buffers every frame.

let cachedBucketInput: FlightState[] | null = null;
let cachedBuckets: Map<AircraftModelKey, FlightState[]> | null = null;

export function bucketFlightsByModel(
  flights: FlightState[],
): Map<AircraftModelKey, FlightState[]> {
  // Return cached result if the flights array reference hasn't changed
  if (flights === cachedBucketInput && cachedBuckets) {
    return cachedBuckets;
  }

  // Invalidate model key cache on new data (new aircraft may appear)
  invalidateModelKeyCache();

  const buckets = new Map<AircraftModelKey, FlightState[]>();

  for (const flight of flights) {
    const key = resolveModelKeyCached(flight);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(flight);
    } else {
      buckets.set(key, [flight]);
    }
  }

  cachedBucketInput = flights;
  cachedBuckets = buckets;
  return buckets;
}

// ── Preloading ─────────────────────────────────────────────────────────

let preloaded = false;

const PREFETCH_KEYS: AircraftModelKey[] = [
  "narrowbody",
  "b737",
  "widebody-2eng",
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

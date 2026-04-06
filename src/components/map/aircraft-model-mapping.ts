// ── Aircraft Model Mapping ─────────────────────────────────────────────
//
// Maps ADS-B category + ICAO typeCode → 3D model silhouette.
// Models are Draco-compressed GLB files served from Cloudinary CDN.
// Local backups remain in public/models/aircraft/.
//
// Category-based fallback assigns generic silhouettes (narrowbody, etc.).
// TypeCode-based matching routes iconic types (A380, B737) to dedicated models.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "@/lib/opensky";

import { MODEL_MESH_METRICS } from "./model-mesh-metrics";

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

const CLOUDINARY_CLOUD = "dfyrk32ua";
const CLOUDINARY_FOLDER = "aeris/models/aircraft";

// Per-model Cloudinary versions from upload response — ensures optimal
// CDN cache (long-lived Cache-Control) and instant busting on re-upload.
const MODEL_CDN_VERSIONS: Readonly<Record<string, number>> = {
  b737: 1774203409,
  bizjet: 1774203410,
  fighter: 1774203411,
  glider: 1774203411,
  helicopter: 1774203412,
  "light-prop": 1774203413,
  narrowbody: 1774203413,
  "regional-jet": 1774203414,
  turboprop: 1774203415,
  "widebody-2eng": 1774203416,
  "widebody-4eng": 1774203418,
};

type AircraftModelFileKey = keyof typeof MODEL_MESH_METRICS;

// A380 reuses the widebody-4eng mesh (it IS the A380 from FlightAirMap).
// generic.glb and narrowbody.glb are identical files; drone.glb and light-prop.glb likewise.
const MODEL_FILE_OVERRIDES: Partial<
  Record<AircraftModelKey, AircraftModelFileKey>
> = {
  a380: "widebody-4eng",
  generic: "narrowbody",
  drone: "light-prop",
};

export function resolveModelFileKey(
  key: AircraftModelKey,
): AircraftModelFileKey {
  return MODEL_FILE_OVERRIDES[key] ?? (key as AircraftModelFileKey);
}

export function modelUrl(key: AircraftModelKey): string {
  const file = resolveModelFileKey(key);
  const version = MODEL_CDN_VERSIONS[file] ?? 1;
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/raw/upload/v${version}/${CLOUDINARY_FOLDER}/${file}.glb`;
}

// ── Mesh Normalization + Compact Physical Scale ───────────────────────

const TARGET_MODEL_EXTENT_UNITS = 42;

export const MODEL_KEY_WINGSPAN: Readonly<Record<AircraftModelKey, number>> = {
  a380: 80,
  "widebody-4eng": 64,
  "widebody-2eng": 62,
  b737: 35.9,
  narrowbody: 36,
  "regional-jet": 24,
  turboprop: 27,
  bizjet: 20,
  helicopter: 14,
  "light-prop": 11,
  fighter: 11,
  glider: 18,
  drone: 5,
  generic: 30,
};

const REFERENCE_MODEL_KEY: AircraftModelKey = "narrowbody";
const REFERENCE_WINGSPAN_METERS = MODEL_KEY_WINGSPAN[REFERENCE_MODEL_KEY];
const REFERENCE_MESH_EXTENT_UNITS =
  MODEL_MESH_METRICS[resolveModelFileKey(REFERENCE_MODEL_KEY)].maxExtent;

export function wingspanToDisplayScale(
  wingspan: number,
): number {
  return 0.65 + Math.max(0, Math.min((wingspan - 5) / 75, 1)) * 0.65;
}

function wingspanToModelDisplayScale(
  wingspan: number,
  meshMaxExtent: number = REFERENCE_MESH_EXTENT_UNITS,
): number {
  return (
    wingspan / REFERENCE_WINGSPAN_METERS
  ) * Math.sqrt(meshMaxExtent / REFERENCE_MESH_EXTENT_UNITS);
}

export function modelMeshNormalize(key: AircraftModelKey): number {
  const fileKey = resolveModelFileKey(key);
  return TARGET_MODEL_EXTENT_UNITS / MODEL_MESH_METRICS[fileKey].maxExtent;
}

export function modelPhysicalScale(key: AircraftModelKey): number {
  const fileKey = resolveModelFileKey(key);
  return wingspanToModelDisplayScale(
    MODEL_KEY_WINGSPAN[key],
    MODEL_MESH_METRICS[fileKey].maxExtent,
  );
}

export function modelDisplayScale(key: AircraftModelKey): number {
  return modelPhysicalScale(key);
}

/** Returns the mesh normalization factor for a model type */
export function modelNormScale(key: AircraftModelKey): number {
  return modelMeshNormalize(key);
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

/**
 * Maps ICAO type designator to a model key. Returns null for unrecognized types.
 *
 * Patterns checked in priority order — first match wins. This ordering
 * prevents false positives (e.g. C919 matching bizjet C[5-9]xx, or
 * Fokker F28 matching the fighter F-series pattern).
 *
 * Sources: ICAO Doc 8643 Aircraft Type Designators.
 */
export function typeCodeToModelKey(
  typeCode: string | null | undefined,
): AircraftModelKey | null {
  if (!typeCode) return null;
  const tc = typeCode.toUpperCase();

  // ── Narrowbody airliners ─────────────────────────────────────────
  // Airbus A318/A319/A320/A321, neo variants (A19N/A20N/A21N),
  // Airbus A220 (BCS1/BCS3), Boeing 717, COMAC C919
  if (/^A31[89]$|^A32\d$|^A(?:19|20|21)N$|^BCS[13]$|^B712$|^C919$/.test(tc))
    return "narrowbody";

  // ── Widebody twins ───────────────────────────────────────────────
  // A300/A310, A330, A350 (incl. A35K = A350-1000)
  if (/^A30[0-9B]$|^A310$|^A33\d$|^A35[0-9K]$/.test(tc)) return "widebody-2eng";

  // Airbus A380
  if (/^A38\d$/.test(tc)) return "a380";

  // Airbus A340 (four-engine widebody)
  if (/^A34\d$/.test(tc)) return "widebody-4eng";

  // Boeing 737 family (incl. MAX 7/8/9/10: B37M/B38M/B39M/B3XM)
  if (/^B73\d$|^B3[789X]M$/.test(tc)) return "b737";

  // Boeing 757
  if (/^B75\d$/.test(tc)) return "narrowbody";

  // Boeing 767
  if (/^B76\d$/.test(tc)) return "widebody-2eng";

  // Boeing 777/787
  if (/^B77\d$|^B77[LW]$|^B78\d$|^B78X$/.test(tc)) return "widebody-2eng";

  // Boeing 747 (incl. SP/SR letter-suffix variants)
  if (/^B74[0-9FRSP]$/.test(tc)) return "widebody-4eng";

  // ── Regional jets ────────────────────────────────────────────────
  // CRJ (incl. CRJX = CRJ-1000), Embraer E-Jets (E170/E175/E190/E195,
  // E2: E275/E290/E295, + E75L/E75S), Fokker F28/F70/F100,
  // BAe 146 (B461-B463), Antonov An-148/158, Sukhoi Superjet, ARJ21
  if (
    /^CRJ[0-9X]?$|^E1[79]\d$|^E[27][79]\d$|^E75[0-9LS]$|^F(?:28|70|10\d)$|^B46[1-3]$|^A148$|^A158$|^SU95$|^AJ27$/.test(
      tc,
    )
  )
    return "regional-jet";

  // ── Turboprops ───────────────────────────────────────────────────
  // ATR, Dash-8, Saab 340/2000, Jetstream, Fokker F27/F50,
  // Beechcraft 1900, Embraer EMB 110/120
  if (
    /^AT[47]\d$|^DH8[A-D]?$|^SF34$|^SB20$|^JS[34]\d$|^F(?:27|50)$|^B190$|^E1[12]0$/.test(
      tc,
    )
  )
    return "turboprop";

  // ── Business jets ────────────────────────────────────────────────
  // Gulfstream (GLF/G-series), Bombardier Global (GLEX/GL5T/GL7T),
  // Challenger, Dassault Falcon (FA-series, F2TH, F900),
  // Learjet, Cessna Citation (C5xx-C9xx + C25A-C), Hawker (H25x),
  // Embraer Phenom/Legacy (E55P/E550/E545), Pilatus PC-24,
  // HondaJet, Beechjet (BE40)
  if (
    /^GLF\d$|^GL[5-7][T0-9]$|^GLEX$|^G[2-7]\d{2}$|^CL[3-6]\d$|^FA\d[0-9X]$|^F2TH$|^F900$|^LJ\d{2}$|^C[5-9]\d{2}$|^C25[A-C]$|^GA\d[0-9C]$|^H25[0-9A-Z]?$|^E[35]5[0-9P]$|^E545$|^PC24$|^HDJT$|^BE40$/.test(
      tc,
    )
  )
    return "bizjet";

  // ── Light GA ─────────────────────────────────────────────────────
  // Cessna single/twin, Piper, Cirrus, Diamond, SOCATA, Mooney, Beechcraft
  if (
    /^C[12]\d{2}$|^PA\d{2}$|^SR2\d$|^DA[24]\d$|^TB\d{2}$|^M20\d?$|^BE[3-9]\d$/.test(
      tc,
    )
  ) {
    // Exclude military/utility types that happen to match the Cessna pattern
    if (/^C130$|^C212$|^C295$/.test(tc)) return null;
    return "light-prop";
  }

  // ── Helicopters ──────────────────────────────────────────────────
  // Airbus/Eurocopter, Sikorsky, Robinson, Aérospatiale, MBB
  if (/^H[16]\d{2}$|^EC\d{2}$|^S[67]\d$|^R[24]\d$|^AS\d{2}$|^BK\d{2}$/.test(tc))
    return "helicopter";
  // Bell: B0xx-B4xx (B190 and B46x already handled in turboprop/regional)
  if (/^B[0-4]\d{2}$/.test(tc) && !/^B19\d$|^B46\d$/.test(tc))
    return "helicopter";
  // AgustaWestland: A10x-A19x (A148/A158 already handled in regional)
  if (/^A1[0-9]\d$/.test(tc) && tc !== "A148" && tc !== "A158")
    return "helicopter";

  // ── Military fighters ────────────────────────────────────────────
  // F-series (Fokker F27/F28/F50 already handled in turboprop/regional)
  if (/^F\d{1,2}[A-Z]?$/.test(tc)) return "fighter";
  // Eurofighter, Tornado, Mikoyan
  if (/^EF\d/.test(tc) || tc === "TOR" || /^MIG\d/.test(tc)) return "fighter";
  // Sukhoi fighters (SU95 Superjet already handled in regional)
  if (/^SU\d/.test(tc) && tc !== "SU95") return "fighter";

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
// Avoids re-running up to 20 regex tests per flight per frame.
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

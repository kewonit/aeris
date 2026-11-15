// ── Aircraft Model Mapping ─────────────────────────────────────────────
//
// Maps ADS-B category + ICAO typeCode → 3D model silhouette.
// Models are GLB files served from Cloudinary CDN, built from the sources in
// tools/models/source by `npm run data:models` into public/models/aircraft/,
// then uploaded. Set NEXT_PUBLIC_AERIS_MODEL_BASE=/models/aircraft to load
// the local build instead, to check models before uploading them.
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
  | "generic"
  // Type-specific models, from Flightradar24.
  | "a318"
  | "a319"
  | "a320"
  | "a321"
  | "a332"
  | "a333"
  | "a343"
  | "a346"
  | "a359"
  | "b738"
  | "b739"
  | "b744"
  | "b748"
  | "b752"
  | "b753"
  | "b762"
  | "b763"
  | "b764"
  | "b772"
  | "b773"
  | "b788"
  | "b789"
  | "e170"
  | "e190"
  | "crj700"
  | "crj900"
  | "cs100"
  | "cs300"
  | "q400"
  | "atr42"
  | "atr72"
  | "bae146"
  | "citation"
  | "pa28";

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
  "a318",
  "a319",
  "a320",
  "a321",
  "a332",
  "a333",
  "a343",
  "a346",
  "a359",
  "b738",
  "b739",
  "b744",
  "b748",
  "b752",
  "b753",
  "b762",
  "b763",
  "b764",
  "b772",
  "b773",
  "b788",
  "b789",
  "e170",
  "e190",
  "crj700",
  "crj900",
  "cs100",
  "cs300",
  "q400",
  "atr42",
  "atr72",
  "bae146",
  "citation",
  "pa28",
] as const;

// ── URL Resolution ─────────────────────────────────────────────────────

const CLOUDINARY_CLOUD = "dfyrk32ua";
const CLOUDINARY_FOLDER = "aeris/models/aircraft";

// Per-model Cloudinary versions from upload response - ensures optimal
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

type AircraftModelFileKey =
  | "b737"
  | "bizjet"
  | "fighter"
  | "glider"
  | "helicopter"
  | "light-prop"
  | "narrowbody"
  | "regional-jet"
  | "turboprop"
  | "widebody-2eng"
  | "widebody-4eng"
  | "a318"
  | "a319"
  | "a320"
  | "a321"
  | "a332"
  | "a333"
  | "a343"
  | "a346"
  | "a359"
  | "b738"
  | "b739"
  | "b744"
  | "b748"
  | "b752"
  | "b753"
  | "b762"
  | "b763"
  | "b764"
  | "b772"
  | "b773"
  | "b788"
  | "b789"
  | "e170"
  | "e190"
  | "crj700"
  | "crj900"
  | "cs100"
  | "cs300"
  | "q400"
  | "atr42"
  | "bae146"
  | "citation"
  | "pa28"
  | "a380";

// Keys that draw another key's model: the generic and drone models were
// copies of the narrowbody and light-prop ones, and the ATR 72 is the
// ATR 42's model drawn at its own wingspan.
const MODEL_FILE_OVERRIDES: Partial<
  Record<AircraftModelKey, AircraftModelFileKey>
> = {
  generic: "narrowbody",
  drone: "light-prop",
  atr72: "atr42",
};

export function resolveModelFileKey(
  key: AircraftModelKey,
): AircraftModelFileKey {
  return MODEL_FILE_OVERRIDES[key] ?? (key as AircraftModelFileKey);
}

/** Where models load from instead of Cloudinary, while checking a build. */
const LOCAL_MODEL_BASE = process.env.NEXT_PUBLIC_AERIS_MODEL_BASE;

/**
 * Each model comes at two levels of detail: light, for the hundred and more
 * aircraft on the map, and detailed, for the one flown in first person.
 */
export type ModelDetail = "map" | "detail";

export function modelUrl(
  key: AircraftModelKey,
  detail: ModelDetail = "map",
): string {
  const file = `${resolveModelFileKey(key)}${detail === "detail" ? "-detail" : ""}`;
  if (LOCAL_MODEL_BASE) return `${LOCAL_MODEL_BASE}/${file}.glb`;
  const version = MODEL_CDN_VERSIONS[file] ?? 1;
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/raw/upload/v${version}/${CLOUDINARY_FOLDER}/${file}.glb`;
}

// ── Real wingspans ─────────────────────────────────────────────────────

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
  a318: 34.1,
  a319: 35.8,
  a320: 35.8,
  a321: 35.8,
  a332: 60.3,
  a333: 60.3,
  a343: 60.3,
  a346: 63.5,
  a359: 64.8,
  b738: 35.8,
  b739: 35.8,
  b744: 64.4,
  b748: 68.4,
  b752: 38.1,
  b753: 38.1,
  b762: 47.6,
  b763: 47.6,
  b764: 51.9,
  b772: 60.9,
  b773: 60.9,
  b788: 60.1,
  b789: 60.1,
  e170: 26.0,
  e190: 28.7,
  crj700: 23.2,
  crj900: 24.9,
  cs100: 35.1,
  cs300: 35.1,
  q400: 28.4,
  atr42: 24.6,
  atr72: 27.1,
  bae146: 26.3,
  citation: 15.9,
  pa28: 10.7,
};

// ── Per-Model Yaw Offset ───────────────────────────────────────────────
//
// Each GLB was authored/exported with a different nose direction in model space.
// These offsets rotate each model so that at yaw=0 the nose faces North:
// 90 means the nose lies along +X, 180 along +Z, and 0 along -Z.
//
// Determined by analysing each model's node rotations and nose-indicator
// node translations (CockpitWindows, pilot_tubes, windscreen, etc.).

const MODEL_YAW_OFFSET: Readonly<Record<AircraftModelKey, number>> = {
  b737: 0, // no node rotation, nose at -Z → already faces North
  narrowbody: 90, // 180° Y rotation, nose raw +X → model +X → East at yaw=0
  generic: 90, // identical mesh to narrowbody
  "widebody-2eng": 180, // 90° Y rotation, nose raw +Z → model -X → South
  "widebody-4eng": 180, // same rotation family
  a380: 0, // Flightradar24 model
  "regional-jet": 180, // 90° Y rotation, nose indicators at +Z
  bizjet: 180, // 90° Y rotation, Glass.inside near +Z
  helicopter: 180, // 90° Y rotation, body extends +Z
  glider: 180, // 90° Y rotation, windowR near +Z
  fighter: 180, // 90° Y rotation
  turboprop: 180, // 120° diagonal rotation, cylinder at +Z
  "light-prop": 180, // 120° diagonal rotation
  drone: 180, // identical mesh to light-prop
  // Flightradar24's models stand Y up with the nose along -Z, which
  // tools/optimize-models.ts checks.
  a318: 0,
  a319: 0,
  a320: 0,
  a321: 0,
  a332: 0,
  a333: 0,
  a343: 0,
  a346: 0,
  a359: 0,
  b738: 0,
  b739: 0,
  b744: 0,
  b748: 0,
  b752: 0,
  b753: 0,
  b762: 0,
  b763: 0,
  b764: 0,
  b772: 0,
  b773: 0,
  b788: 0,
  b789: 0,
  e170: 0,
  e190: 0,
  crj700: 0,
  crj900: 0,
  cs100: 0,
  cs300: 0,
  q400: 0,
  atr42: 0,
  atr72: 0,
  bae146: 0,
  citation: 0,
  pa28: 0,
};

/**
 * The turn about the model's up axis, in degrees, that points its nose
 * along +X, so every model shares one frame and pitch and bank turn each
 * about the same axes.
 */
export function modelNoseTurn(key: AircraftModelKey): number {
  return MODEL_YAW_OFFSET[key] - 90;
}

// ── Type designator → type-specific model ─────────────────────────────
//
// ICAO designators with a model of their own (from Flightradar24). A close
// sibling borrows one where it has none: the neo and MAX families take their
// predecessors', the A350-1000 the A350-900's, and the 777-300ER the 777-300's.
// Anything not listed falls through to the generic families below.

const TYPE_SPECIFIC_MODEL: Readonly<Record<string, AircraftModelKey>> = {
  // Airbus narrowbodies and the A220
  A318: "a318",
  A319: "a319",
  A19N: "a319",
  A320: "a320",
  A20N: "a320",
  A321: "a321",
  A21N: "a321",
  BCS1: "cs100",
  BCS3: "cs300",
  // Airbus widebodies
  A332: "a332",
  A338: "a332",
  A333: "a333",
  A339: "a333",
  A342: "a343",
  A343: "a343",
  A345: "a346",
  A346: "a346",
  A359: "a359",
  A35K: "a359",
  A388: "a380",
  // Boeing 737
  B736: "b737",
  B737: "b737",
  B37M: "b737",
  B738: "b738",
  B38M: "b738",
  B739: "b739",
  B39M: "b739",
  B3XM: "b739",
  // Boeing widebodies and the 757
  B741: "b744",
  B742: "b744",
  B743: "b744",
  B744: "b744",
  B74R: "b744",
  B74S: "b744",
  B748: "b748",
  B752: "b752",
  B753: "b753",
  B762: "b762",
  B763: "b763",
  B764: "b764",
  B772: "b772",
  B77L: "b772",
  B773: "b773",
  B77W: "b773",
  B778: "b773",
  B779: "b773",
  B788: "b788",
  B789: "b789",
  B78X: "b789",
  // Regional jets and turboprops
  E170: "e170",
  E175: "e170",
  E75L: "e170",
  E75S: "e170",
  E190: "e190",
  E195: "e190",
  E290: "e190",
  E295: "e190",
  CRJ7: "crj700",
  CRJ9: "crj900",
  CRJX: "crj900",
  DH8D: "q400",
  AT43: "atr42",
  AT44: "atr42",
  AT45: "atr42",
  AT46: "atr42",
  AT72: "atr72",
  AT73: "atr72",
  AT75: "atr72",
  AT76: "atr72",
  B461: "bae146",
  B462: "bae146",
  B463: "bae146",
  RJ70: "bae146",
  RJ85: "bae146",
  RJ1H: "bae146",
  // Cessna Citations and the Piper Cherokee
  C500: "citation",
  C501: "citation",
  C510: "citation",
  C525: "citation",
  C25A: "citation",
  C25B: "citation",
  C25C: "citation",
  C25M: "citation",
  C550: "citation",
  C551: "citation",
  C55B: "citation",
  C560: "citation",
  C56X: "citation",
  C650: "citation",
  C680: "citation",
  C68A: "citation",
  C700: "citation",
  C750: "citation",
  P28A: "pa28",
  P28B: "pa28",
  P28R: "pa28",
  P28T: "pa28",
};

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
 * Patterns checked in priority order - first match wins. This ordering
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

  // ── Type-specific models ─────────────────────────────────────────
  const specific = TYPE_SPECIFIC_MODEL[tc];
  if (specific) return specific;

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
  // Beechcraft 1900, Embraer EMB 110/120, Beechcraft King Air
  if (
    /^AT[47]\d$|^DH8[A-D]?$|^SF34$|^SB20$|^JS[34]\d$|^F(?:27|50)$|^B190$|^E1[12]0$|^B350$|^BE20$|^BE9[LT]$/.test(
      tc,
    )
  )
    return "turboprop";

  // ── Business jets ────────────────────────────────────────────────
  // Gulfstream (GLF/G-series), Bombardier Global (GLEX/GL5T/GL7T),
  // Challenger, Dassault Falcon (FA-series, F2TH, F900),
  // Learjet, Cessna Citation (C5xx-C9xx and the C25A, C55B, C56X, and
  // C68A letter variants), Hawker (H25x),
  // Embraer Phenom/Legacy (E55P/E550/E545), Pilatus PC-24,
  // HondaJet, Beechjet (BE40)
  if (
    /^GLF\d$|^GL[5-7][T0-9]$|^GLEX$|^G[2-7]\d{2}$|^CL[3-6]\d$|^FA\d[0-9X]$|^F2TH$|^F900$|^LJ\d{2}$|^C[5-9]\d{2}$|^C(?:25|55|56|68)[A-Z]$|^GA\d[0-9C]$|^H25[0-9A-Z]?$|^E[35]5[0-9P]$|^E545$|^PC24$|^HDJT$|^BE40$/.test(
      tc,
    )
  )
    return "bizjet";

  // ── Light GA ─────────────────────────────────────────────────────
  // Cessna singles and twins with their RG and turbo variants (C72R,
  // T206, P210), Piper (PA28, P28A, P32R), Cirrus (incl. S22T), Diamond,
  // SOCATA, Mooney, Beechcraft, Van's RV, Glasair, Champion
  if (
    /^C[1-4]\d{2}$|^C(?:72|77|82)[A-Z]$|^[TP]2\d{2}$|^PA\d{2}[A-Z]?$|^P\d{2}[A-Z]$|^SR2\d$|^S22T$|^DA[24]\d$|^TB\d{2}$|^M20[0-9A-Z]?$|^BE[3-9]\d$|^RV\d{1,2}[A-Z]?$|^GLA[SX]$|^GLST$|^CH7[A-Z]$/.test(
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
  // Bell: B06 and B0xx-B4xx (B190, B350, and B46x are already handled as
  // turboprops and regional jets above)
  if (/^B0\d[A-Z]?$|^B[0-4]\d{2}$/.test(tc) && !/^B19\d$|^B46\d$/.test(tc))
    return "helicopter";
  // Boeing Chinook, Sikorsky Black Hawk, Bell Huey
  if (/^H(?:47|60)$|^UH1[A-Z]?$/.test(tc)) return "helicopter";
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

// The types most often in the sky, fetched early so the first aircraft
// drawn as models don't wait for theirs.
const PREFETCH_KEYS: AircraftModelKey[] = ["a320", "b738", "a321"];

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

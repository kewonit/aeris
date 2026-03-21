import type { AtcFeed, AtcFeedType } from "./atc-types";
import { FEED_TYPE_PRIORITY } from "./atc-types";
import { ATC_FEEDS, getFeedsByIcao } from "./atc-feeds";
import { AIRPORTS, type Airport } from "./airports";

// ── Constants ──────────────────────────────────────────────────────────

/** Approximate nautical miles per degree of latitude. */
const NM_PER_DEG = 60;

/** Maximum search radius in nautical miles for auto-feed discovery. */
const MAX_SEARCH_RADIUS_NM = 60;

// ── IATA → ICAO mapping ───────────────────────────────────────────────

/**
 * Common IATA → ICAO mapping for airports in the feed database.
 * Only includes airports that have ATC feeds to keep the map small.
 */
const IATA_TO_ICAO: Record<string, string> = {
  // United States
  JFK: "KJFK",
  LAX: "KLAX",
  ORD: "KORD",
  ATL: "KATL",
  DFW: "KDFW",
  DEN: "KDEN",
  SFO: "KSFO",
  LAS: "KLAS",
  MIA: "KMIA",
  EWR: "KEWR",
  SEA: "KSEA",
  BOS: "KBOS",
  MSP: "KMSP",
  PHX: "KPHX",
  DTW: "KDTW",
  FLL: "KFLL",
  IAD: "KIAD",
  CLT: "KCLT",
  DCA: "KDCA",
  HNL: "PHNL",
  ANC: "PANC",
  // Europe
  LHR: "EGLL",
  CDG: "LFPG",
  AMS: "EHAM",
  FRA: "EDDF",
  MAD: "LEMD",
  MUC: "EDDM",
  IST: "LTFM",
  LGW: "EGKK",
  BCN: "LEBL",
  FCO: "LIRF",
  ZRH: "LSZH",
  DUB: "EIDW",
  VIE: "LOWW",
  OSL: "ENGM",
  CPH: "EKCH",
  ARN: "ESSA",
  WAW: "EPWA",
  LIS: "LPPT",
  // Middle East
  DXB: "OMDB",
  DOH: "OTHH",
  JED: "OEJN",
  // Asia Pacific
  HND: "RJTT",
  NRT: "RJAA",
  SIN: "WSSS",
  HKG: "VHHH",
  ICN: "RKSI",
  BKK: "VTBS",
  KUL: "WMKK",
  DEL: "VIDP",
  BOM: "VABB",
  // Australia / Oceania
  SYD: "YSSY",
  MEL: "YMML",
  AKL: "NZAA",
  // Americas (non-US)
  YYZ: "CYYZ",
  YVR: "CYVR",
  MEX: "MMMX",
  GRU: "SBGR",
  EZE: "SAEZ",
  SCL: "SCEL",
  BOG: "SKBO",
  // Africa
  JNB: "FAOR",
  CAI: "HECA",
};

const ICAO_TO_IATA: Record<string, string> = {};
for (const [iata, icao] of Object.entries(IATA_TO_ICAO)) {
  ICAO_TO_IATA[icao] = iata;
}

/**
 * Convert IATA code to ICAO code for airports in the feed database.
 */
export function iataToIcao(iata: string): string | null {
  return IATA_TO_ICAO[iata.toUpperCase()] ?? null;
}

/**
 * Convert ICAO code to IATA code for airports in the feed database.
 */
export function icaoToIata(icao: string): string | null {
  return ICAO_TO_IATA[icao.toUpperCase()] ?? null;
}

/** ICAO codes of airports that have ATC feeds. */
const ICAO_SET = new Set(Object.keys(ATC_FEEDS));

/** Precomputed list of airports that have ATC feeds. */
const ATC_AIRPORTS: Airport[] = AIRPORTS.filter((a) => {
  // Match by converting IATA → ICAO convention for known airports
  // LiveATC uses ICAO codes; our airport DB uses IATA
  const icao = iataToIcao(a.iata);
  return icao !== null && ICAO_SET.has(icao);
});

// ── Lookup Functions ───────────────────────────────────────────────────

/**
 * Simple distance approximation in nautical miles (good enough for feed lookup).
 * Uses equirectangular approximation — accurate to ~1% within 60nm.
 */
function approxDistanceNm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * NM_PER_DEG;
  const dLng =
    (lng2 - lng1) *
    NM_PER_DEG *
    Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export type NearbyAtcResult = {
  /** Airport ICAO code */
  icao: string;
  /** Airport IATA code (if known) */
  iata: string | null;
  /** Airport name */
  name: string;
  /** Distance in nautical miles */
  distanceNm: number;
  /** Available ATC feeds, sorted by type priority */
  feeds: AtcFeed[];
};

/**
 * Find airports with ATC feeds near a given latitude/longitude.
 * Returns results sorted by distance (nearest first).
 *
 * @param lat Latitude in degrees
 * @param lng Longitude in degrees
 * @param radiusNm Search radius in nautical miles (default: 60)
 * @param limit Maximum results to return (default: 5)
 */
export function findNearbyAtcFeeds(
  lat: number,
  lng: number,
  radiusNm: number = MAX_SEARCH_RADIUS_NM,
  limit: number = 5,
): NearbyAtcResult[] {
  const clampedRadius = Math.min(radiusNm, MAX_SEARCH_RADIUS_NM);
  const results: NearbyAtcResult[] = [];

  for (const airport of ATC_AIRPORTS) {
    const dist = approxDistanceNm(lat, lng, airport.lat, airport.lng);
    if (dist > clampedRadius) continue;

    const icao = iataToIcao(airport.iata);
    if (!icao) continue;

    const feeds = getFeedsByIcao(icao).sort(
      (a, b) => FEED_TYPE_PRIORITY[a.type] - FEED_TYPE_PRIORITY[b.type],
    );

    if (feeds.length === 0) continue;

    results.push({
      icao,
      iata: airport.iata,
      name: airport.name,
      distanceNm: Math.round(dist * 10) / 10,
      feeds,
    });
  }

  results.sort((a, b) => a.distanceNm - b.distanceNm);
  return results.slice(0, limit);
}

/**
 * Find the single nearest airport with ATC feeds.
 * Convenience wrapper around findNearbyAtcFeeds.
 */
export function findNearestAtcFeed(
  lat: number,
  lng: number,
): NearbyAtcResult | null {
  const results = findNearbyAtcFeeds(lat, lng, MAX_SEARCH_RADIUS_NM, 1);
  return results[0] ?? null;
}

/**
 * Look up ATC feeds by IATA or ICAO code.
 */
export function lookupAtcFeeds(code: string): AtcFeed[] {
  const upper = code.toUpperCase();

  // Try ICAO first
  const icaoFeeds = getFeedsByIcao(upper);
  if (icaoFeeds.length > 0) return icaoFeeds;

  // Try IATA → ICAO
  const icao = iataToIcao(upper);
  if (icao) return getFeedsByIcao(icao);

  return [];
}

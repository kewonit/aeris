// ── Location Search Client ─────────────────────────────────────────────
//
// Combines three search sources into a unified interface:
//   1. Local airports   (instant, 9000+ entries from airports.ts)
//   2. Featured cities  (instant, hardcoded popular hubs)
//   3. Nominatim places (async, global geocoding via /api/geocode proxy)
//
// All results normalize to a common `SearchLocation` type.
// ────────────────────────────────────────────────────────────────────────

import type { City } from "./cities";
import { CITIES } from "./cities";
import { searchAirports, type Airport } from "./airports";
import type { NominatimResult } from "@/app/api/geocode/route";

// ── Types ──────────────────────────────────────────────────────────────

export type LocationSource = "airport" | "city" | "place";

export interface SearchLocation {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  coordinates: [number, number]; // [lon, lat]
  source: LocationSource;
  /** Airport IATA code or empty string for places */
  code: string;
  /** Full display name with context (e.g. "Paris, Île-de-France, France") */
  displayName: string;
  /** Optional: OSM class/type for place results */
  placeType?: string;
}

// ── Nominatim Client-Side Cache ────────────────────────────────────────

interface GeoCacheEntry {
  results: SearchLocation[];
  ts: number;
}

const geoCache = new Map<string, GeoCacheEntry>();
const GEO_CACHE_TTL_MS = 300_000; // 5 minutes - geocode results are stable
const GEO_CACHE_MAX = 20;

function getGeoCached(query: string): SearchLocation[] | undefined {
  const key = query.trim().toLowerCase();
  const entry = geoCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > GEO_CACHE_TTL_MS) {
    geoCache.delete(key);
    return undefined;
  }
  return entry.results;
}

function setGeoCached(query: string, results: SearchLocation[]): void {
  const key = query.trim().toLowerCase();
  if (geoCache.size >= GEO_CACHE_MAX && !geoCache.has(key)) {
    const oldest = geoCache.keys().next().value;
    if (oldest !== undefined) geoCache.delete(oldest);
  }
  geoCache.set(key, { results, ts: Date.now() });
}

// ── Converters ─────────────────────────────────────────────────────────

function airportToLocation(airport: Airport): SearchLocation {
  return {
    id: `apt-${airport.iata}`,
    name: airport.name,
    country: airport.country,
    countryCode: airport.country,
    coordinates: [airport.lng, airport.lat],
    source: "airport",
    code: airport.iata,
    displayName: `${airport.name} — ${airport.city}, ${airport.country}`,
  };
}

function cityToLocation(city: City): SearchLocation {
  return {
    id: city.id,
    name: city.name,
    country: city.country,
    countryCode: city.country,
    coordinates: city.coordinates,
    source: "city",
    code: city.iata,
    displayName: `${city.name} (${city.iata})`,
  };
}

function nominatimToLocation(result: NominatimResult): SearchLocation | null {
  const lat = parseFloat(result.lat);
  const lon = parseFloat(result.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const address = result.address ?? {};
  const countryCode = (address.country_code ?? "").toUpperCase();

  // Use the first part of display_name as the primary name
  const primaryName = result.display_name.split(",")[0]?.trim() ?? result.display_name;

  return {
    id: `nom-${result.place_id}`,
    name: primaryName,
    country: address.country ?? "",
    countryCode,
    coordinates: [lon, lat],
    source: "place",
    code: countryCode,
    displayName: result.display_name,
    placeType: result.type,
  };
}

// ── Local Search ───────────────────────────────────────────────────────

export interface LocalSearchResult {
  airports: SearchLocation[];
  cities: SearchLocation[];
}

/**
 * Search local airports and featured cities instantly (no network).
 */
export function searchLocalLocations(query: string, limit = 10): LocalSearchResult {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      airports: [],
      cities: CITIES.slice(0, 6).map(cityToLocation),
    };
  }

  const featured = CITIES.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.iata.toLowerCase().includes(q) ||
      c.country.toLowerCase().includes(q),
  ).map(cityToLocation);

  const featuredIatas = new Set(CITIES.map((c) => c.iata));
  const airports = searchAirports(q, limit)
    .filter((a) => !featuredIatas.has(a.iata))
    .map(airportToLocation);

  return {
    cities: featured,
    airports,
  };
}

// ── Global Geocode Search ──────────────────────────────────────────────

const GEOCODE_TIMEOUT_MS = 8_000;

/**
 * Search global places via Nominatim (OpenStreetMap) through our proxy.
 * Results are cached client-side for 5 minutes.
 */
export async function searchGeocode(
  query: string,
  signal?: AbortSignal,
): Promise<SearchLocation[]> {
  const normalized = query.trim();
  if (!normalized || normalized.length < 2) return [];

  const cached = getGeoCached(normalized);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(
      `/api/geocode?q=${encodeURIComponent(normalized)}`,
      {
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!res.ok) return [];

    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];

    const results: SearchLocation[] = [];
    for (const item of data) {
      const loc = nominatimToLocation(item as NominatimResult);
      if (loc) results.push(loc);
    }

    setGeoCached(normalized, results);
    return results;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return [];
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Convert a SearchLocation to a City object for compatibility with the
 * existing map navigation system.
 */
export function locationToCity(loc: SearchLocation): City {
  return {
    id: loc.id,
    name: loc.name,
    country: loc.countryCode || loc.country || "",
    // Use 3-letter code if available, otherwise derive from name or use placeholder
    iata:
      loc.code.length === 3
        ? loc.code.toUpperCase()
        : loc.code.toUpperCase().padEnd(3, "X").slice(0, 3),
    coordinates: loc.coordinates,
    radius: 2.49,
  };
}

/**
 * Clear the geocode cache.
 */
export function clearGeocodeCache(): void {
  geoCache.clear();
}

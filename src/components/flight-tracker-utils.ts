import { CITIES, type City } from "@/lib/cities";
import { findByIata, airportToCity } from "@/lib/airports";
import { MAP_STYLES, DEFAULT_STYLE, type MapStyle } from "@/lib/map-styles";
import { ICAO24_REGEX } from "@/lib/flight-api-types";

export { DEFAULT_STYLE, ICAO24_REGEX };

export const DEFAULT_CITY_ID = "sfo";
export const STYLE_STORAGE_KEY = "aeris:mapStyle";
export const DEFAULT_CITY =
  CITIES.find((c) => c.id === DEFAULT_CITY_ID) ?? CITIES[0];
export const GITHUB_REPO_URL = "https://github.com/kewonit/aeris";
export const GITHUB_REPO_API = "https://api.github.com/repos/kewonit/aeris";

export const subscribeNoop = () => () => {};

let _cachedInitialCity: City | null = null;

export function resolveInitialCity(): City {
  if (_cachedInitialCity) return _cachedInitialCity;
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("city")?.trim().toUpperCase();
    if (!code) {
      _cachedInitialCity = DEFAULT_CITY;
      return DEFAULT_CITY;
    }

    const preset = CITIES.find(
      (c) => c.iata.toUpperCase() === code || c.id === code.toLowerCase(),
    );
    if (preset) {
      _cachedInitialCity = preset;
      return preset;
    }

    const airport = findByIata(code);
    if (airport) {
      _cachedInitialCity = airportToCity(airport);
      return _cachedInitialCity;
    }

    _cachedInitialCity = DEFAULT_CITY;
    return DEFAULT_CITY;
  } catch {
    // Not in a browser environment (SSR) — fall back to default city
    _cachedInitialCity = DEFAULT_CITY;
    return DEFAULT_CITY;
  }
}

export function syncCityToUrl(city: City): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("city", city.iata);
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    url.searchParams.delete("fpv");
    window.history.replaceState(null, "", url.toString());
  } catch {
    // URL parsing or history API may fail in non-browser environments
  }
}

export function syncFpvToUrl(icao24: string | null, activeCity?: City): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (icao24) {
      url.searchParams.set("fpv", icao24);
      url.searchParams.delete("city");
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    } else {
      url.searchParams.delete("fpv");
      if (activeCity) {
        url.searchParams.set("city", activeCity.iata);
      }
    }
    window.history.replaceState(null, "", url.toString());
  } catch {
    // URL parsing or history API may fail in non-browser environments
  }
}

export function resolveInitialFpv(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("fpv")?.trim().toLowerCase();
    return raw && /^[0-9a-f]{6}$/.test(raw) ? raw : null;
  } catch {
    // Not in a browser environment (SSR)
    return null;
  }
}

export function loadMapStyle(): MapStyle {
  try {
    const id = localStorage.getItem(STYLE_STORAGE_KEY);
    if (!id) return DEFAULT_STYLE;
    return MAP_STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
  } catch {
    // localStorage unavailable (SSR, private browsing, or quota exceeded)
    return DEFAULT_STYLE;
  }
}

export function saveMapStyle(style: MapStyle): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, style.id);
  } catch {
    // localStorage unavailable (private browsing or quota exceeded)
  }
}

export function formatStarCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

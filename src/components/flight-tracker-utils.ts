import { CITIES, type City } from "@/lib/cities";
import { MAP_STYLES, DEFAULT_STYLE, type MapStyle } from "@/lib/map-styles";
import { ICAO24_REGEX } from "@/lib/flight-api-types";
import { buildCanonicalCityPath, findCityByCode } from "@/lib/city-routing";

export { DEFAULT_STYLE, ICAO24_REGEX };

export const DEFAULT_CITY_ID = "sfo";
export const STYLE_STORAGE_KEY = "aeris:mapStyle";
export const DEFAULT_CITY =
  CITIES.find((c) => c.id === DEFAULT_CITY_ID) ?? CITIES[0];
export const GITHUB_REPO_URL = "https://github.com/kewonit/aeris";
export const GITHUB_REPO_API = "https://api.github.com/repos/kewonit/aeris";

export const subscribeNoop = () => () => {};

let _cachedInitialCity: City | null = null;
let _cachedInitialCityKey: string | null = null;

/** Matches `/city/<3-letter-iata>` (case-insensitive). */
const CITY_PATH_RE = /^\/city\/([A-Za-z]{3})\/?$/;

export function resolveInitialCity(): City {
  try {
    const locationKey = `${window.location.pathname}${window.location.search}`;
    if (_cachedInitialCity && _cachedInitialCityKey === locationKey) {
      return _cachedInitialCity;
    }

    // New canonical form: /city/<iata>
    const pathMatch = window.location.pathname.match(CITY_PATH_RE);
    if (pathMatch) {
      const city = findCityByCode(pathMatch[1]);
      if (city) {
        _cachedInitialCity = city;
        _cachedInitialCityKey = locationKey;
        return city;
      }
    }

    // Legacy form (still supported client-side as a safety net; the
    // server-side proxy normally redirects this before hydration).
    const params = new URLSearchParams(window.location.search);
    const code = params.get("city")?.trim();
    if (code) {
      const city = findCityByCode(code);
      if (city) {
        _cachedInitialCity = city;
        _cachedInitialCityKey = locationKey;
        return city;
      }
    }

    _cachedInitialCity = DEFAULT_CITY;
    _cachedInitialCityKey = locationKey;
    return DEFAULT_CITY;
  } catch {
    // Not in a browser environment (SSR) - fall back to default city
    _cachedInitialCity = DEFAULT_CITY;
    _cachedInitialCityKey = null;
    return DEFAULT_CITY;
  }
}

/**
 * Builds the shareable canonical pathname for a city.
 */
function cityPathname(city: City): string {
  return buildCanonicalCityPath(city);
}

/** Query parameters that point at an aircraft or an airport. */
const LINK_PARAMS = ["fpv", "follow", "sel", "airport"] as const;
const HEX_RE = /^[0-9a-f]{6}$/;
const IATA_RE = /^[A-Z]{3}$/;

/** What a shared link asks to open. */
export type SelectionLink =
  | { mode: "fpv" | "follow" | "select"; icao24: string }
  | { mode: "airport"; iata: string };

/** The parts of the selection a link can carry. */
export type LinkableSelection = {
  selection:
    | { kind: "none" }
    | { kind: "aircraft"; icao24: string }
    | { kind: "airport"; iata: string };
  follow: string | null;
  fpv: string | null;
};

/**
 * Reads the link from a query string. First person wins over follow, follow
 * over a plain selection, so older `?fpv=` links keep working.
 */
export function parseSelectionLink(search: string): SelectionLink | null {
  const params = new URLSearchParams(search);
  const hex = (key: string) => {
    const raw = params.get(key)?.trim().toLowerCase();
    return raw && HEX_RE.test(raw) ? raw : null;
  };
  const fpv = hex("fpv");
  if (fpv) return { mode: "fpv", icao24: fpv };
  const follow = hex("follow");
  if (follow) return { mode: "follow", icao24: follow };
  const sel = hex("sel");
  if (sel) return { mode: "select", icao24: sel };
  const airport = params.get("airport")?.trim().toUpperCase();
  if (airport && IATA_RE.test(airport)) return { mode: "airport", iata: airport };
  return null;
}

/** Writes the selection into `params`, replacing any earlier link. */
export function writeSelectionLink(
  params: URLSearchParams,
  state: LinkableSelection,
): void {
  for (const key of LINK_PARAMS) params.delete(key);
  if (state.fpv) {
    params.set("fpv", state.fpv);
  } else if (state.follow) {
    params.set("follow", state.follow);
  } else if (state.selection.kind === "aircraft") {
    params.set("sel", state.selection.icao24);
  } else if (state.selection.kind === "airport") {
    params.set("airport", state.selection.iata);
  }
}

function replaceUrl(url: URL): void {
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function syncCityToUrl(city: City): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    // Legacy ?city=… must go - canonical is now the pathname.
    url.searchParams.delete("city");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    for (const key of LINK_PARAMS) url.searchParams.delete(key);
    url.pathname = cityPathname(city);
    replaceUrl(url);
  } catch {
    // URL parsing or history API may fail in non-browser environments
  }
}

/** Keeps the address bar pointing at what is open, without adding history. */
export function syncSelectionToUrl(state: LinkableSelection): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("city");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    const before = url.search;
    writeSelectionLink(url.searchParams, state);
    if (url.search !== before) replaceUrl(url);
  } catch {
    // URL parsing or history API may fail in non-browser environments
  }
}

export function resolveInitialLink(): SelectionLink | null {
  try {
    return parseSelectionLink(window.location.search);
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

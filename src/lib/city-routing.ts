import type { City } from "./cities";
import { CITIES } from "./cities";
import { airportToCity, findByIata } from "./airports";

type CitySearchParams =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

const IATA_CODE_RE = /^[A-Za-z]{3}$/;

function toUrlSearchParams(
  searchParams: CitySearchParams = "",
): URLSearchParams {
  if (
    typeof searchParams === "string" ||
    searchParams instanceof URLSearchParams
  ) {
    return new URLSearchParams(searchParams);
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
      continue;
    }

    if (typeof value === "string") {
      params.set(key, value);
    }
  }

  return params;
}

export function findCityByCode(code: string): City | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  const preset = CITIES.find(
    (city) => city.iata.toUpperCase() === upper || city.id === lower,
  );
  if (preset) return preset;

  const airport = findByIata(upper);
  return airport ? airportToCity(airport) : null;
}

export function buildCanonicalCityPath(city: City): string {
  return `/city/${city.iata.toLowerCase()}`;
}

export function buildLegacyCityRedirectTarget(
  code: string,
  searchParams: CitySearchParams = "",
): string | null {
  const trimmed = code.trim();
  if (!IATA_CODE_RE.test(trimmed)) return null;

  const city = findCityByCode(trimmed);
  const params = toUrlSearchParams(searchParams);
  params.delete("city");

  const pathname = city
    ? buildCanonicalCityPath(city)
    : `/city/${trimmed.toLowerCase()}`;
  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

export function canonicalizeCityRequest(
  code: string,
  searchParams: CitySearchParams = "",
): string | null {
  const city = findCityByCode(code);
  if (!city) return null;

  const currentCode = code.trim();
  const params = toUrlSearchParams(searchParams);
  const hadLegacyCityParam = params.has("city");
  params.delete("city");

  if (currentCode === city.iata.toLowerCase() && !hadLegacyCityParam) {
    return null;
  }

  const canonicalPath = buildCanonicalCityPath(city);
  const query = params.toString();
  return query ? `${canonicalPath}?${query}` : canonicalPath;
}

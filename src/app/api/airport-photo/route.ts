import { NextRequest, NextResponse } from "next/server";

// ── Airport Photo Proxy ────────────────────────────────────────────────
//
// Resolves an airport (by IATA + name) to a Wikipedia thumbnail URL.
//
// One API call to Wikipedia's REST search endpoint returns a small thumbnail
// plus the canonical page title. We upscale the thumbnail URL path from the
// returned variant to a card-appropriate 500px variant — Wikimedia's thumb
// server only accepts a fixed set of widths (20/40/60/120/250/330/500/960/
// 1280/1920/3840), and anything else returns a 429. See:
// https://www.mediawiki.org/wiki/Common_thumbnail_sizes
//
// Attribution: per Wikipedia's license (CC BY-SA / CC0 for most files),
// we return the page URL so the client can link back. User-Agent header
// identifies this app per Wikimedia's policy:
// https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy

const WIKI_SEARCH_BASE = "https://en.wikipedia.org/w/rest.php/v1/search/title";
const FETCH_TIMEOUT_MS = 6_000;
const USER_AGENT =
  "Aeris/1.0 (https://github.com/kewonit/aeris; flight-tracker)";
const TARGET_THUMB_WIDTH = 500;
const SEARCH_RESULT_LIMIT = 5;
const MIN_PAGE_SCORE = 50;
const EARLY_RETURN_SCORE = 110;

/**
 * Permissive but safe query validator — allows Unicode letters/marks/digits
 * (so airports named "São Paulo", "Zürich", "Köln", "Kraków" etc. work) plus
 * a few punctuation chars common in airport names. Caps length to prevent
 * oversized upstream calls.
 */
const SAFE_QUERY = /^[\p{L}\p{M}\p{N}\s.\-&()/,'"–—’]{1,128}$/u;
const SAFE_CODE = /^[A-Z0-9]{3,4}$/;

type AirportPhotoLookup = {
  name: string;
  iata: string | null;
  icao: string | null;
  city: string | null;
};

type SearchPage = {
  id: number;
  key: string;
  title: string;
  description?: string | null;
  thumbnail?: {
    url: string;
    width: number;
    height: number;
  } | null;
};

type AirportPhoto = {
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  pageUrl: string;
  pageTitle: string;
  description: string | null;
};

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function readOptionalQuery(
  value: string | null | undefined,
  validator: RegExp,
  transform: (value: string) => string = (next) => next,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || !validator.test(trimmed)) return null;
  return transform(trimmed);
}

function buildSearchQueries(lookup: AirportPhotoLookup): string[] {
  const queries = [
    lookup.name,
    `${lookup.name} airport`,
    lookup.city ? `${lookup.name} ${lookup.city}` : null,
    lookup.iata ? `${lookup.iata} airport` : null,
    lookup.icao ? `${lookup.icao} airport` : null,
    lookup.city ? `${lookup.city} airport` : null,
  ];

  return [
    ...new Set(queries.filter((value): value is string => Boolean(value))),
  ];
}

function scoreSearchPage(page: SearchPage, lookup: AirportPhotoLookup): number {
  if (!page.thumbnail?.url) return Number.NEGATIVE_INFINITY;

  const title = normalizeSearchText(page.title);
  const key = normalizeSearchText(page.key);
  const description = normalizeSearchText(page.description ?? "");
  const haystack = `${title} ${key} ${description}`;
  const name = normalizeSearchText(lookup.name);
  const city = lookup.city ? normalizeSearchText(lookup.city) : "";

  let score = 0;

  if (title === name || key === name) score += 90;
  else if (title.includes(name) || key.includes(name)) score += 60;

  if (lookup.iata && haystack.includes(normalizeSearchText(lookup.iata))) {
    score += 18;
  }

  if (lookup.icao && haystack.includes(normalizeSearchText(lookup.icao))) {
    score += 24;
  }

  if (city && haystack.includes(city)) {
    score += 10;
  }

  if (
    [
      "airport",
      "international",
      "regional",
      "airfield",
      "aerodrome",
      "heliport",
    ].some((term) => haystack.includes(term))
  ) {
    score += 18;
  }

  if (
    [
      "station",
      "railway",
      "metro",
      "tv series",
      "film",
      "album",
      "song",
      "disambiguation",
    ].some((term) => haystack.includes(term))
  ) {
    score -= 45;
  }

  return score;
}

function selectBestSearchPage(
  pages: SearchPage[],
  lookup: AirportPhotoLookup,
): SearchPage | null {
  let bestPage: SearchPage | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const page of pages) {
    const score = scoreSearchPage(page, lookup);
    if (score > bestScore) {
      bestScore = score;
      bestPage = page;
    }
  }

  return bestScore >= MIN_PAGE_SCORE ? bestPage : null;
}

function toAirportPhoto(page: SearchPage): AirportPhoto {
  let thumbUrl = page.thumbnail!.url;
  if (thumbUrl.startsWith("//")) thumbUrl = `https:${thumbUrl}`;
  const upsized = thumbUrl.replace(/\/\d+px-/, `/${TARGET_THUMB_WIDTH}px-`);

  let imageUrl = upsized;
  const originalMatch = thumbUrl.match(
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/thumb\/(.*?)\/[^/]+$/,
  );
  if (originalMatch) {
    imageUrl = `${originalMatch[1]}/${originalMatch[2]}`;
  }

  return {
    imageUrl,
    thumbUrl: upsized,
    width: TARGET_THUMB_WIDTH,
    height: Math.round(
      (TARGET_THUMB_WIDTH * page.thumbnail!.height) / page.thumbnail!.width,
    ),
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
    pageTitle: page.title,
    description: page.description ?? null,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const name = request.nextUrl.searchParams.get("name")?.trim();
  const lookup: AirportPhotoLookup = {
    name: name ?? "",
    iata: readOptionalQuery(
      request.nextUrl.searchParams.get("iata"),
      SAFE_CODE,
      (value) => value.toUpperCase(),
    ),
    icao: readOptionalQuery(
      request.nextUrl.searchParams.get("icao"),
      SAFE_CODE,
      (value) => value.toUpperCase(),
    ),
    city: readOptionalQuery(
      request.nextUrl.searchParams.get("city"),
      SAFE_QUERY,
    ),
  };

  if (!name || !SAFE_QUERY.test(name)) {
    return NextResponse.json(
      { error: "Invalid or missing 'name' parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let bestPage: SearchPage | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    try {
      for (const query of buildSearchQueries(lookup)) {
        const url = `${WIKI_SEARCH_BASE}?q=${encodeURIComponent(query)}&limit=${SEARCH_RESULT_LIMIT}`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
        });

        if (!res.ok) {
          return NextResponse.json(
            { error: `Upstream returned ${res.status}` },
            { status: 502, headers: { "Cache-Control": "no-store" } },
          );
        }

        const data = (await res.json()) as { pages?: SearchPage[] };
        const candidate = selectBestSearchPage(data.pages ?? [], lookup);
        if (!candidate) continue;

        const score = scoreSearchPage(candidate, lookup);
        if (score > bestScore) {
          bestScore = score;
          bestPage = candidate;
        }

        if (score >= EARLY_RETURN_SCORE) {
          break;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const page = bestPage;
    if (!page || !page.thumbnail?.url) {
      return NextResponse.json(
        { photo: null },
        {
          headers: {
            // Negative caches are still worth caching briefly so we don't
            // re-hit Wikipedia for every airport with no image.
            "Cache-Control":
              "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
          },
        },
      );
    }
    const photo = toAirportPhoto(page);

    return NextResponse.json(
      { photo },
      {
        headers: {
          // Photos rarely change. Cache hard at the edge; let the browser
          // keep it for a day.
          "Cache-Control":
            "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        },
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Upstream timeout" },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch airport photo" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const __internals = {
  buildSearchQueries,
  normalizeSearchText,
  scoreSearchPage,
  selectBestSearchPage,
};

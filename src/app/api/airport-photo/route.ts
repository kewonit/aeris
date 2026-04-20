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
// https://api.wikimedia.org/wiki/Documentation/UA_policy

const WIKI_SEARCH_BASE = "https://en.wikipedia.org/w/rest.php/v1/search/title";
const FETCH_TIMEOUT_MS = 6_000;
const USER_AGENT =
  "Aeris/1.0 (https://github.com/kewonit/aeris; flight-tracker)";
const TARGET_THUMB_WIDTH = 500;

/**
 * Permissive but safe query validator — allows Unicode letters/marks/digits
 * (so airports named "São Paulo", "Zürich", "Köln", "Kraków" etc. work) plus
 * a few punctuation chars common in airport names. Caps length to prevent
 * oversized upstream calls.
 */
const SAFE_QUERY = /^[\p{L}\p{M}\p{N}\s.\-&()/,'"–—’]{1,128}$/u;

type AirportPhoto = {
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  pageUrl: string;
  pageTitle: string;
  description: string | null;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const name = request.nextUrl.searchParams.get("name")?.trim();

  if (!name || !SAFE_QUERY.test(name)) {
    return NextResponse.json(
      { error: "Invalid or missing 'name' parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const url = `${WIKI_SEARCH_BASE}?q=${encodeURIComponent(name)}&limit=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data = (await res.json()) as {
      pages?: Array<{
        id: number;
        key: string;
        title: string;
        description?: string | null;
        thumbnail?: {
          url: string;
          width: number;
          height: number;
        } | null;
      }>;
    };

    const page = data.pages?.[0];
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

    // Protocol-relative → absolute https.
    // Swap the thumbnail size path segment (e.g. `/60px-`) to a 500px variant.
    // Wikimedia only serves a fixed set of widths; anything else → 429.
    let thumbUrl = page.thumbnail.url;
    if (thumbUrl.startsWith("//")) thumbUrl = `https:${thumbUrl}`;
    const upsized = thumbUrl.replace(/\/\d+px-/, `/${TARGET_THUMB_WIDTH}px-`);

    // Derive the original (non-thumb) image URL by stripping the `/thumb/`
    // segment and the final /Npx-FILE suffix. Falls back to upsized thumb
    // when the pattern doesn't match, so we never hand back a broken URL.
    let imageUrl = upsized;
    const originalMatch = thumbUrl.match(
      /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/thumb\/(.*?)\/[^/]+$/,
    );
    if (originalMatch) {
      imageUrl = `${originalMatch[1]}/${originalMatch[2]}`;
    }

    const photo: AirportPhoto = {
      imageUrl,
      thumbUrl: upsized,
      // Dimensions at target width, preserving aspect ratio.
      width: TARGET_THUMB_WIDTH,
      height: Math.round(
        (TARGET_THUMB_WIDTH * page.thumbnail.height) / page.thumbnail.width,
      ),
      pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
      pageTitle: page.title,
      description: page.description ?? null,
    };

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

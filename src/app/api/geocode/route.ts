import { NextRequest, NextResponse } from "next/server";

// ── Nominatim Geocode Proxy ────────────────────────────────────────────
//
// Proxies OpenStreetMap Nominatim search to:
//   1. Identify the application properly (User-Agent)
//   2. Enforce rate limits server-side (1 req/s per Nominatim policy)
//   3. Cache results to reduce upstream load
//   4. Prevent abuse by validating/sanitizing inputs
//
// Nominatim docs: https://nominatim.org/release-docs/develop/api/Search/
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
// ────────────────────────────────────────────────────────────────────────

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_RATE_MS = 1_100; // 1 req/s + 100ms margin
const NOMINATIM_TIMEOUT_MS = 8_000;
const MAX_QUERY_LENGTH = 120;

// ── Server-Side Rate Limiter ───────────────────────────────────────────

let lastRequestTime = 0;
let rateLimitQueue: Promise<void> = Promise.resolve();

async function enforceRateLimit(): Promise<void> {
  const previous = rateLimitQueue;

  const next = previous.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, NOMINATIM_RATE_MS - (now - lastRequestTime));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestTime = Date.now();
  });

  rateLimitQueue = next.catch(() => {});
  return next;
}

// ── Response Types ─────────────────────────────────────────────────────

export interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  class: string;
  type: string;
  place_rank: number;
  importance: number;
  addresstype: string;
  name: string | null;
  display_name: string;
  boundingbox: [string, string, string, string];
  address?: {
    country?: string;
    country_code?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    county?: string;
    suburb?: string;
  };
}

// ── Handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json(
      { error: "Missing 'q' parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: "Query too long" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Basic sanitization: strip control characters
  const sanitized = q.replace(/[\x00-\x1F\x7F]/g, "");
  if (!sanitized) {
    return NextResponse.json(
      { error: "Invalid query" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await enforceRateLimit();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      q: sanitized,
      format: "jsonv2",
      limit: "10",
      addressdetails: "1",
      // Restrict to places people would want to see flights over
      // (cities, towns, airports, landmarks, natural features)
      // We do NOT restrict by class/type to keep results broad,
      // but we filter client-side for relevance.
    });

    const upstream = await fetch(`${NOMINATIM_BASE}?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Aeris/1.0 (https://github.com/kewonit/aeris)",
      },
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Nominatim returned ${upstream.status}` },
        {
          status: upstream.status >= 500 ? 502 : upstream.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Nominatim returned non-JSON response" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data: unknown = await upstream.json();

    if (!Array.isArray(data)) {
      return NextResponse.json(
        { error: "Unexpected Nominatim response format" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Validate and sanitize each result
    const results: NominatimResult[] = [];
    for (const item of data) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.place_id !== "number" ||
        typeof item.display_name !== "string" ||
        typeof item.lat !== "string" ||
        typeof item.lon !== "string"
      ) {
        continue;
      }
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      if (
        Number.isNaN(lat) ||
        Number.isNaN(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        continue;
      }
      results.push(item as NominatimResult);
    }

    return NextResponse.json(results, {
      status: 200,
      headers: {
        // Geocode results are stable for hours/days
        "Cache-Control": "public, max-age=3600, s-maxage=7200",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "Nominatim request timed out" : "Nominatim request failed" },
      { status: isTimeout ? 504 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

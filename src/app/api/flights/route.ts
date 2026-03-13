import { NextRequest, NextResponse } from "next/server";

// ── adsb.lol Proxy ─────────────────────────────────────────────────────
//
// Proxies requests to adsb.lol which lacks CORS headers.
// Validates path patterns to prevent SSRF.

const ADSB_LOL_BASE = "https://api.adsb.lol/v2";

const FETCH_TIMEOUT_MS = 10_000;

// ── Path validation (SSRF prevention) ──────────────────────────────────

/**
 * Only allow known readsb endpoint patterns.
 * - /point/{lat}/{lon}/{radius}  — lat/lon can be negative decimals, radius is integer
 * - /hex/{hex}                   — 6-char lowercase hex ICAO address
 * - /callsign/{callsign}        — alphanumeric callsign
 */
const VALID_PATH =
  /^\/(?:point\/-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?\/\d{1,3}|hex\/[0-9a-f]{6}|callsign\/[A-Z0-9-]{1,8})$/i;

// ── Rate limiter (in-memory) ───────────────────────────────────────────

let lastRequestTime = 0;
const RATE_MS = 500; // self-imposed: 2 req/s for adsb.lol

// ── Handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.searchParams.get("path")?.trim();

  if (!path || !VALID_PATH.test(path)) {
    return NextResponse.json(
      { error: "Invalid or missing 'path' parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Rate limit check
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < RATE_MS) {
    return NextResponse.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": "1" },
      },
    );
  }
  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${ADSB_LOL_BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `adsb.lol returned ${upstream.status}` },
        {
          status: upstream.status >= 500 ? 502 : upstream.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const data: unknown = await upstream.json();

    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3, s-maxage=3" },
    });
  } catch {
    clearTimeout(timer);
    return NextResponse.json(
      { error: "adsb.lol request failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

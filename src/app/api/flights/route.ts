import { NextRequest, NextResponse } from "next/server";
import { READSB_FETCH_TIMEOUT_MS, MAX_RADIUS_NM } from "@/lib/flight-api-types";

// ── adsb.lol Proxy ─────────────────────────────────────────────────────
//
// Proxies requests to adsb.lol which lacks CORS headers.
// Validates path patterns to prevent SSRF.

const ADSB_LOL_BASE = "https://api.adsb.lol/v2";

// ── Path validation (SSRF prevention) ──────────────────────────────────

/**
 * Only allow known readsb endpoint patterns.
 * - /point/{lat}/{lon}/{radius}  — lat/lon can be negative decimals, radius is integer
 * - /hex/{hex}                   — 6-char lowercase hex ICAO address
 * - /callsign/{callsign}        — alphanumeric callsign
 */
const VALID_PATH =
  /^\/(?:point\/-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?\/\d{1,3}|hex\/[0-9a-f]{6}|callsign\/[A-Z0-9-]{1,8})$/i;

// ── Handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.searchParams.get("path")?.trim();

  if (!path || !VALID_PATH.test(path)) {
    return NextResponse.json(
      { error: "Invalid or missing 'path' parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Validate radius for /point endpoints against max allowed
  const pointMatch = path.match(/^\/point\/[^/]+\/[^/]+\/(\d+)$/);
  if (pointMatch && parseInt(pointMatch[1], 10) > MAX_RADIUS_NM) {
    return NextResponse.json(
      { error: `Radius exceeds maximum of ${MAX_RADIUS_NM} NM` },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READSB_FETCH_TIMEOUT_MS);

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

    // Reject non-JSON responses (CloudFlare challenges, maintenance pages)
    const ct = upstream.headers.get("content-type") ?? "";
    if (ct.includes("text/html") || ct.includes("text/xml")) {
      return NextResponse.json(
        { error: "adsb.lol returned a non-JSON response" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data: unknown = await upstream.json();

    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3, s-maxage=3" },
    });
  } catch (err) {
    clearTimeout(timer);

    const isTimeout = err instanceof DOMException && err.name === "AbortError";

    return NextResponse.json(
      {
        error: isTimeout
          ? "adsb.lol request timed out"
          : "adsb.lol request failed",
      },
      {
        status: isTimeout ? 504 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

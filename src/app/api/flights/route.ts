import { NextRequest, NextResponse } from "next/server";
import { READSB_FETCH_TIMEOUT_MS, MAX_RADIUS_NM } from "@/lib/flight-api-types";

// ── Multi-Provider Proxy ───────────────────────────────────────────────
//
// Proxies readsb-format requests to adsb.lol, adsb.fi, or airplanes.live.
// These APIs lack browser-compatible CORS headers, so a server-side proxy is
// required.
//
// Usage:
//   /api/flights?path=/point/lat/lon/radius              → adsb.lol (default)
//   /api/flights?path=/point/lat/lon/radius&provider=adsbfi → adsb.fi
//   /api/flights?path=/hex/abcdef&provider=airplanes      → airplanes.live
//   /api/flights?path=/callsign/BAW123&provider=adsb      → adsb.lol
//
// SSRF prevention: path patterns are validated against a strict allowlist.
// Per-provider server-side rate limiting prevents exceeding upstream limits.
// ────────────────────────────────────────────────────────────────────────

// ── Provider Configuration ─────────────────────────────────────────────

type ProviderKey = "adsb" | "adsbfi" | "airplanes";

interface ProviderConfig {
  baseUrl: string;
  name: string;
  /** Minimum interval between server-side requests (ms) */
  rateMs: number;
}

const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  adsb: {
    baseUrl: "https://api.adsb.lol/v2",
    name: "adsb.lol",
    rateMs: 500,
  },
  adsbfi: {
    baseUrl: "https://opendata.adsb.fi/api",
    name: "adsb.fi",
    rateMs: 1_100, // Public API limit: 1 req/s per IP
  },
  airplanes: {
    baseUrl: "https://api.airplanes.live/v2",
    name: "airplanes.live",
    rateMs: 1_100, // Conservative best-effort floor; no published 2.0.0 quota
  },
};

const UPSTREAM_USER_AGENT =
  "AerisFlightTracker/0.8.8 (+https://github.com/kewonit/aeris)";

// ── Server-Side Rate Limiter (per provider, concurrency-safe) ──────────

const lastRequestTime: Record<string, number> = {};
const rateLimitQueues: Record<string, Promise<void>> = {};

async function enforceRateLimit(provider: ProviderKey): Promise<void> {
  const previous = rateLimitQueues[provider] ?? Promise.resolve();

  const next = previous.then(async () => {
    const now = Date.now();
    const last = lastRequestTime[provider] ?? 0;
    const config = PROVIDERS[provider];
    const wait = Math.max(0, config.rateMs - (now - last));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestTime[provider] = Date.now();
  });

  // Ensure the chain continues even if a previous step rejects.
  rateLimitQueues[provider] = next.catch(() => {});

  return next;
}

// ── Path validation (SSRF prevention) ──────────────────────────────────

/**
 * Only allow known readsb endpoint patterns.
 * - /point/{lat}/{lon}/{radius}  - lat/lon can be negative decimals, radius is integer
 * - /hex/{hex}                   - 6-char lowercase hex ICAO address
 * - /callsign/{callsign}        - alphanumeric callsign
 */
const LOOKUP_PATH = /^\/(?:hex\/[0-9a-f]{6}|callsign\/[A-Z0-9-]{1,8})$/i;
const POINT_PATH =
  /^\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/;

function validatePath(path: string): string | null {
  if (LOOKUP_PATH.test(path)) return null;

  const pointMatch = path.match(POINT_PATH);
  if (!pointMatch) return "Invalid or missing 'path' parameter";

  const lat = Number(pointMatch[1]);
  const lon = Number(pointMatch[2]);
  const radius = Number(pointMatch[3]);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return "Latitude must be between -90 and 90";
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return "Longitude must be between -180 and 180";
  }
  if (!Number.isFinite(radius) || radius < 0 || radius > MAX_RADIUS_NM) {
    return `Radius must be between 0 and ${MAX_RADIUS_NM} NM`;
  }

  return null;
}

function buildUpstreamUrl(provider: ProviderKey, path: string): string {
  const config = PROVIDERS[provider];

  if (provider !== "adsbfi") return `${config.baseUrl}${path}`;

  const pointMatch = path.match(POINT_PATH);
  if (pointMatch) {
    const [, lat, lon, radius] = pointMatch;
    return `${config.baseUrl}/v3/lat/${lat}/lon/${lon}/dist/${radius}`;
  }

  return `${config.baseUrl}/v2${path}`;
}

// ── Handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.searchParams.get("path")?.trim();

  const pathError = path ? validatePath(path) : "Invalid or missing 'path' parameter";
  if (!path || pathError) {
    return NextResponse.json(
      { error: pathError },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Validate provider (explicit check avoids prototype-chain pitfalls of `in`)
  const providerRaw =
    request.nextUrl.searchParams.get("provider")?.toLowerCase() ?? "adsb";

  if (
    providerRaw !== "adsb" &&
    providerRaw !== "adsbfi" &&
    providerRaw !== "airplanes"
  ) {
    return NextResponse.json(
      { error: "Invalid provider. Use 'adsb', 'adsbfi', or 'airplanes'." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const provider: ProviderKey = providerRaw;
  const config = PROVIDERS[provider];

  // Enforce server-side rate limit for this provider
  await enforceRateLimit(provider);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READSB_FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(buildUpstreamUrl(provider, path), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": UPSTREAM_USER_AGENT,
      },
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `${config.name} returned ${upstream.status}` },
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
        { error: `${config.name} returned a non-JSON response` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data: unknown = await upstream.json();

    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3, s-maxage=8" },
    });
  } catch (err) {
    clearTimeout(timer);

    const isTimeout = err instanceof DOMException && err.name === "AbortError";

    return NextResponse.json(
      {
        error: isTimeout
          ? `${config.name} request timed out`
          : `${config.name} request failed`,
      },
      {
        status: isTimeout ? 504 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

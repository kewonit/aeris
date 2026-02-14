import { NextRequest, NextResponse } from "next/server";

const OPENSKY_BASE = "https://opensky-network.org/api";
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// OAuth2 token cache
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  // Reuse token if still valid (with 60s margin)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  try {
    const res = await fetch(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(
        `[aeris] OAuth2 token request failed: ${res.status} ${res.statusText}`,
      );
      cachedToken = null;
      return null;
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in ?? 1800) * 1000;

    if (process.env.NODE_ENV === "development") {
      console.info(
        `[aeris] OAuth2 token acquired, expires in ${data.expires_in}s`,
      );
    }

    return cachedToken;
  } catch (err) {
    console.error("[aeris] OAuth2 token error:", err);
    cachedToken = null;
    return null;
  }
}

type AuthMode = "oauth2" | "basic" | "anonymous";
let authDisabled = false;
let authLoggedOnce = false;

function detectAuthMode(): AuthMode {
  if (authDisabled) return "anonymous";
  if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
    return "oauth2";
  if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD)
    return "basic";
  return "anonymous";
}

async function buildAuthHeaders(): Promise<HeadersInit> {
  const mode = detectAuthMode();

  if (mode === "oauth2") {
    const token = await getAccessToken();
    if (token) return { Authorization: `Bearer ${token}` };
    return {}; // token fetch failed — fall through
  }

  if (mode === "basic") {
    const user = process.env.OPENSKY_USERNAME!;
    const pass = process.env.OPENSKY_PASSWORD!;
    return {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    };
  }

  return {};
}

function logAuthStatus() {
  if (authLoggedOnce) return;
  authLoggedOnce = true;

  const mode = detectAuthMode();
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    console.info("┌───────────────────────────────────────────────────┐");
    if (mode === "oauth2") {
      console.info("│  ✓ OpenSky: OAuth2 client credentials             │");
      console.info(
        `│    Client: ${(process.env.OPENSKY_CLIENT_ID ?? "").slice(0, 37).padEnd(39)}│`,
      );
    } else if (mode === "basic") {
      console.info("│  ✓ OpenSky: Basic auth (legacy)                   │");
      console.info(
        `│    User: ${(process.env.OPENSKY_USERNAME ?? "").slice(0, 38).padEnd(40)}│`,
      );
    } else {
      console.info("│  ✗ OpenSky: Anonymous mode (rate-limited)         │");
      console.info("│    Set OPENSKY_CLIENT_ID & OPENSKY_CLIENT_SECRET  │");
      console.info("│    in .env.local for authenticated access          │");
    }
    console.info("└───────────────────────────────────────────────────┘");
  } else {
    console.info(`[aeris] Proxy: ${mode} mode`);
  }
}

// Per-IP rate limiter
const requestLog = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 20;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const timestamps = requestLog.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < windowMs);
  recent.push(now);
  requestLog.set(ip, recent);

  // Clean up stale entries periodically
  if (requestLog.size > 500) {
    for (const [key, val] of requestLog) {
      if (val.every((t) => now - t > windowMs)) requestLog.delete(key);
    }
  }

  return recent.length > MAX_REQUESTS_PER_MINUTE;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

async function fetchFromOpenSky(
  url: string,
  useAuth: boolean,
): Promise<Response> {
  const headers = useAuth ? await buildAuthHeaders() : {};
  return fetch(url, { headers, cache: "no-store" });
}

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { time: 0, states: null, rateLimited: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { searchParams } = request.nextUrl;
  const lamin = searchParams.get("lamin");
  const lamax = searchParams.get("lamax");
  const lomin = searchParams.get("lomin");
  const lomax = searchParams.get("lomax");

  if (!lamin || !lamax || !lomin || !lomax) {
    return NextResponse.json(
      { error: "Missing required bbox parameters" },
      { status: 400 },
    );
  }

  const raw = { lamin: +lamin, lamax: +lamax, lomin: +lomin, lomax: +lomax };
  for (const [key, val] of Object.entries(raw)) {
    if (Number.isNaN(val)) {
      return NextResponse.json(
        { error: `Invalid parameter: ${key}` },
        { status: 400 },
      );
    }
  }

  // Clamp to valid geographic ranges and limit bbox size
  const coords = {
    lamin: clamp(raw.lamin, -90, 90),
    lamax: clamp(raw.lamax, -90, 90),
    lomin: clamp(raw.lomin, -180, 180),
    lomax: clamp(raw.lomax, -180, 180),
  };

  const latSpan = Math.abs(coords.lamax - coords.lamin);
  const lonSpan = Math.abs(coords.lomax - coords.lomin);
  if (latSpan > 20 || lonSpan > 20) {
    return NextResponse.json(
      { error: "Bounding box too large (max 20° per axis)" },
      { status: 400 },
    );
  }

  if (!authLoggedOnce) logAuthStatus();

  const url = `${OPENSKY_BASE}/states/all?lamin=${coords.lamin}&lamax=${coords.lamax}&lomin=${coords.lomin}&lomax=${coords.lomax}`;
  const useAuth = detectAuthMode() !== "anonymous";

  try {
    let res = await fetchFromOpenSky(url, useAuth);

    // On 401, invalidate token/auth and retry anonymously
    if (res.status === 401 && useAuth) {
      cachedToken = null;
      tokenExpiresAt = 0;
      authDisabled = true;
      console.warn(
        "[aeris] Auth rejected (401). Falling back to anonymous. Check credentials in .env.local",
      );
      res = await fetchFromOpenSky(url, false);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("X-Rate-Limit-Retry-After-Seconds");
      return NextResponse.json(
        {
          time: 0,
          states: null,
          rateLimited: true,
          retryAfter: retryAfter ? parseInt(retryAfter, 10) : null,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!res.ok) {
      console.error(`[aeris] OpenSky error: ${res.status} ${res.statusText}`);
      return NextResponse.json(
        { error: "Upstream data source error" },
        { status: 502 },
      );
    }

    const data = await res.json();

    // Log remaining credits in dev
    if (process.env.NODE_ENV === "development") {
      const remaining = res.headers.get("X-Rate-Limit-Remaining");
      if (remaining) {
        console.info(`[aeris] API credits remaining: ${remaining}`);
      }
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[aeris] OpenSky proxy error:", err);
    return NextResponse.json(
      { error: "Failed to fetch flight data" },
      { status: 502 },
    );
  }
}

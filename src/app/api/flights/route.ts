import { NextRequest, NextResponse } from "next/server";

const OPENSKY_BASE = "https://opensky-network.org/api";
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const TOKEN_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 25_000;
const MAX_REQUESTS_PER_MINUTE = 20;
const MAX_BBOX_SPAN = 20;
const CACHE_GRID_STEP = 0.5;

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
    const res = await fetch(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      console.error(`[aeris] Token request failed: ${res.status}`);
      cachedToken = null;
      return null;
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in ?? 1800) * 1000;
    return cachedToken;
  } catch (err) {
    console.error(
      "[aeris] Token error:",
      err instanceof Error ? err.message : err,
    );
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
    return {};
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

function logAuthOnce() {
  if (authLoggedOnce) return;
  authLoggedOnce = true;
  console.info(`[aeris] Auth mode: ${detectAuthMode()}`);
}

const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const window = 60_000;
  const timestamps = requestLog.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < window);
  recent.push(now);
  requestLog.set(ip, recent);

  if (requestLog.size > 500) {
    for (const [key, val] of requestLog) {
      if (val.every((t) => now - t > window)) requestLog.delete(key);
    }
  }

  return recent.length > MAX_REQUESTS_PER_MINUTE;
}

let responseCache: {
  key: string;
  data: unknown;
  expiresAt: number;
} | null = null;

function getCached(key: string): unknown | null {
  if (
    responseCache &&
    responseCache.key === key &&
    Date.now() < responseCache.expiresAt
  ) {
    return responseCache.data;
  }
  return null;
}

function setCache(key: string, data: unknown): void {
  responseCache = { key, data, expiresAt: Date.now() + CACHE_TTL_MS };
}

async function fetchOpenSky(
  url: string,
  useAuth: boolean,
): Promise<Response> {
  const headers = useAuth ? await buildAuthHeaders() : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function json(
  body: unknown,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return json({ time: 0, states: null, rateLimited: true }, 200);
  }

  const { searchParams } = request.nextUrl;
  const lamin = searchParams.get("lamin");
  const lamax = searchParams.get("lamax");
  const lomin = searchParams.get("lomin");
  const lomax = searchParams.get("lomax");

  if (!lamin || !lamax || !lomin || !lomax) {
    return json({ error: "Missing required bbox parameters" }, 400);
  }

  const raw = { lamin: +lamin, lamax: +lamax, lomin: +lomin, lomax: +lomax };
  for (const [key, val] of Object.entries(raw)) {
    if (Number.isNaN(val)) {
      return json({ error: `Invalid parameter: ${key}` }, 400);
    }
  }

  const coords = {
    lamin: clamp(raw.lamin, -90, 90),
    lamax: clamp(raw.lamax, -90, 90),
    lomin: clamp(raw.lomin, -180, 180),
    lomax: clamp(raw.lomax, -180, 180),
  };

  if (
    Math.abs(coords.lamax - coords.lamin) > MAX_BBOX_SPAN ||
    Math.abs(coords.lomax - coords.lomin) > MAX_BBOX_SPAN
  ) {
    return json(
      { error: `Bounding box too large (max ${MAX_BBOX_SPAN}\u00b0 per axis)` },
      400,
    );
  }

  logAuthOnce();

  // Snap bbox to grid so nearby viewports share cache entries
  const snap = (v: number) =>
    Math.round(v / CACHE_GRID_STEP) * CACHE_GRID_STEP;
  const snapped = {
    lamin: snap(coords.lamin),
    lamax: snap(coords.lamax),
    lomin: snap(coords.lomin),
    lomax: snap(coords.lomax),
  };

  const url = `${OPENSKY_BASE}/states/all?lamin=${snapped.lamin}&lamax=${snapped.lamax}&lomin=${snapped.lomin}&lomax=${snapped.lomax}`;
  const cacheKey = `${snapped.lamin},${snapped.lamax},${snapped.lomin},${snapped.lomax}`;

  const cached = getCached(cacheKey);
  if (cached) {
    return json(cached, 200, { "X-Cache": "HIT" });
  }

  const useAuth = detectAuthMode() !== "anonymous";

  try {
    let res = await fetchOpenSky(url, useAuth);

    if (res.status === 401 && useAuth) {
      cachedToken = null;
      tokenExpiresAt = 0;
      authDisabled = true;
      console.warn("[aeris] Auth rejected (401), falling back to anonymous");
      res = await fetchOpenSky(url, false);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get(
        "X-Rate-Limit-Retry-After-Seconds",
      );
      return json(
        {
          time: 0,
          states: null,
          rateLimited: true,
          retryAfter: retryAfter ? parseInt(retryAfter, 10) : null,
        },
        200,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[aeris] OpenSky ${res.status}: ${body.slice(0, 300)}`);
      return json(
        { error: "Upstream data source error", status: res.status },
        502,
      );
    }

    const creditsRaw = res.headers.get("X-Rate-Limit-Remaining");
    const creditsRemaining =
      creditsRaw !== null ? parseInt(creditsRaw, 10) : null;

    let data;
    try {
      data = await res.json();
    } catch {
      console.error("[aeris] OpenSky returned non-JSON response");
      return json({ error: "Upstream returned invalid response" }, 502);
    }

    if (creditsRemaining !== null && !Number.isNaN(creditsRemaining)) {
      data.creditsRemaining = creditsRemaining;
    }

    setCache(cacheKey, data);
    return json(data, 200, { "X-Cache": "MISS" });
  } catch (err) {
    const isAbort =
      (err instanceof Error && err.name === "AbortError") ||
      (typeof DOMException !== "undefined" &&
        err instanceof DOMException &&
        err.name === "AbortError");

    if (isAbort) {
      console.error(`[aeris] OpenSky timed out (${FETCH_TIMEOUT_MS}ms)`);
      return json(
        { error: "Upstream request timed out", timeout: true },
        504,
      );
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[aeris] Proxy error: ${msg}`);
    return json(
      { error: "Failed to fetch flight data", detail: msg },
      502,
    );
  }
}

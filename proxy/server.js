// Aeris OpenSky API Proxy
// Deployed on Railway to avoid Vercel IP blocks from OpenSky
// -----------------------------------------------------------

const http = require("http");
const { URL, URLSearchParams } = require("url");

const PORT = process.env.PORT || 3001;
const OPENSKY_BASE = "https://opensky-network.org/api";
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

const TOKEN_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 25_000;
const CACHE_GRID_STEP = 0.5;
const MAX_BBOX_SPAN = 20;

// --- CORS ---
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.some(
    (allowed) => origin === allowed || origin.endsWith(`.${allowed.replace(/^https?:\/\//, "")}`),
  );
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// --- Auth ---
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
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
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      console.error(`[proxy] Token request failed: ${res.status}`);
      cachedToken = null;
      return null;
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in ?? 1800) * 1000;
    console.log("[proxy] Token acquired successfully");
    return cachedToken;
  } catch (err) {
    console.error("[proxy] Token error:", err.message || err);
    cachedToken = null;
    return null;
  }
}

function detectAuthMode() {
  if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
    return "oauth2";
  if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD)
    return "basic";
  return "anonymous";
}

async function buildAuthHeaders() {
  const mode = detectAuthMode();

  if (mode === "oauth2") {
    const token = await getAccessToken();
    if (token) return { Authorization: `Bearer ${token}` };
    return {};
  }

  if (mode === "basic") {
    const user = process.env.OPENSKY_USERNAME;
    const pass = process.env.OPENSKY_PASSWORD;
    return {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    };
  }

  return {};
}

// --- Cache ---
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now >= v.expiresAt) cache.delete(k);
    }
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- Fetch ---
async function fetchOpenSky(url, useAuth) {
  const headers = useAuth ? await buildAuthHeaders() : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function snap(v) {
  return Math.round(v / CACHE_GRID_STEP) * CACHE_GRID_STEP;
}

// --- Request handler ---
async function handleFlights(req, res, origin) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const lamin = url.searchParams.get("lamin");
  const lamax = url.searchParams.get("lamax");
  const lomin = url.searchParams.get("lomin");
  const lomax = url.searchParams.get("lomax");

  if (!lamin || !lamax || !lomin || !lomax) {
    return sendJson(res, 400, { error: "Missing required bbox parameters" }, origin);
  }

  const raw = { lamin: +lamin, lamax: +lamax, lomin: +lomin, lomax: +lomax };
  for (const [key, val] of Object.entries(raw)) {
    if (Number.isNaN(val)) {
      return sendJson(res, 400, { error: `Invalid parameter: ${key}` }, origin);
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
    return sendJson(res, 400, { error: `Bounding box too large (max ${MAX_BBOX_SPAN}\u00b0 per axis)` }, origin);
  }

  const snapped = {
    lamin: snap(coords.lamin),
    lamax: snap(coords.lamax),
    lomin: snap(coords.lomin),
    lomax: snap(coords.lomax),
  };

  const cacheKey = `${snapped.lamin},${snapped.lamax},${snapped.lomin},${snapped.lomax}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached, origin, { "X-Cache": "HIT" });
  }

  const apiUrl = `${OPENSKY_BASE}/states/all?lamin=${snapped.lamin}&lamax=${snapped.lamax}&lomin=${snapped.lomin}&lomax=${snapped.lomax}`;
  const useAuth = detectAuthMode() !== "anonymous";

  try {
    let apiRes = await fetchOpenSky(apiUrl, useAuth);

    if (apiRes.status === 401 && useAuth) {
      console.warn("[proxy] Auth rejected (401), retrying anonymous");
      apiRes = await fetchOpenSky(apiUrl, false);
    }

    if (apiRes.status === 429) {
      const retryAfter = apiRes.headers.get("X-Rate-Limit-Retry-After-Seconds");
      return sendJson(res, 200, {
        time: 0,
        states: null,
        rateLimited: true,
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : null,
      }, origin);
    }

    if (!apiRes.ok) {
      const body = await apiRes.text().catch(() => "");
      console.error(`[proxy] OpenSky ${apiRes.status}: ${body.slice(0, 300)}`);
      return sendJson(res, 502, { error: "Upstream data source error", status: apiRes.status }, origin);
    }

    const creditsRaw = apiRes.headers.get("X-Rate-Limit-Remaining");
    const creditsRemaining = creditsRaw !== null ? parseInt(creditsRaw, 10) : null;

    let data;
    try {
      data = await apiRes.json();
    } catch {
      console.error("[proxy] OpenSky returned non-JSON response");
      return sendJson(res, 502, { error: "Upstream returned invalid response" }, origin);
    }

    if (creditsRemaining !== null && !Number.isNaN(creditsRemaining)) {
      data.creditsRemaining = creditsRemaining;
    }

    setCache(cacheKey, data);
    return sendJson(res, 200, data, origin, { "X-Cache": "MISS" });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) {
      console.error(`[proxy] OpenSky timed out (${FETCH_TIMEOUT_MS}ms)`);
      return sendJson(res, 504, { error: "Upstream request timed out", timeout: true }, origin);
    }

    console.error(`[proxy] Proxy error: ${err.message || err}`);
    return sendJson(res, 502, { error: "Failed to fetch flight data", detail: err.message }, origin);
  }
}

function sendJson(res, status, body, origin, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...corsHeaders(origin),
    ...extraHeaders,
  };

  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

// --- Server ---
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // Health check
  if (req.url === "/" || req.url === "/health") {
    sendJson(res, 200, { status: "ok", auth: detectAuthMode() }, origin);
    return;
  }

  // Flights endpoint
  if (req.url?.startsWith("/flights")) {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" }, origin);
      return;
    }

    if (origin && !isOriginAllowed(origin)) {
      sendJson(res, 403, { error: "Origin not allowed" }, origin);
      return;
    }

    await handleFlights(req, res, origin);
    return;
  }

  sendJson(res, 404, { error: "Not found" }, origin);
});

server.listen(PORT, () => {
  console.log(`[proxy] Aeris OpenSky proxy listening on port ${PORT}`);
  console.log(`[proxy] Auth mode: ${detectAuthMode()}`);
  if (ALLOWED_ORIGINS.length > 0) {
    console.log(`[proxy] Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  } else {
    console.log("[proxy] CORS: allowing all origins (set ALLOWED_ORIGINS to restrict)");
  }
});

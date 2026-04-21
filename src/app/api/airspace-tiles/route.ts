import { NextRequest, NextResponse } from "next/server";

// ── OpenAIP Airspace MVT Proxy ──────────────────────────────────────
//
// Proxies Mapbox Vector Tile requests to OpenAIP's tiles API, keeping
// the API key server-side. Validates z/x/y to prevent SSRF and path
// traversal.
//
// Tiles are cached in-memory (24 h TTL, LRU eviction at 2 000 entries)
// to avoid hammering OpenAIP. Concurrent in-flight requests for the
// same tile are coalesced so only one upstream fetch happens. A simple
// queue limits upstream concurrency to 6 and spaces requests by 100 ms.
//
// MVT endpoint:
//   https://{a,b,c}.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.pbf
//
// Docs: https://docs.openaip.net/?urls.primaryName=Tiles%20API
// License: CC BY-NC 4.0 — attribution required.
// ────────────────────────────────────────────────────────────────────

const OPENAIP_API_KEY = process.env.OPENAIP_API_KEY ?? "";

const SUBDOMAINS = ["a", "b", "c"] as const;

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MAX_AGE = 86_400;
const CACHE_TTL_MS = CACHE_MAX_AGE * 1_000;
const MAX_CACHE_ENTRIES = 2_000;

const VALID_TILE_COORD = /^[0-9]{1,7}$/;

type CachedTile =
  | { kind: "data"; data: ArrayBuffer; ts: number }
  | { kind: "empty"; ts: number };

const tileCache = new Map<string, CachedTile>();

function getCached(key: string): CachedTile | undefined {
  const entry = tileCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    tileCache.delete(key);
    return undefined;
  }
  tileCache.delete(key);
  tileCache.set(key, entry);
  return entry;
}

function putCache(key: string, entry: CachedTile) {
  if (tileCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  tileCache.set(key, entry);
}

const inflight = new Map<string, Promise<CachedTile | null>>();

const MAX_CONCURRENT = 6;
const MIN_SPACING_MS = 100;
let activeCount = 0;
let lastFetchMs = 0;
const queue: Array<{ resolve: () => void }> = [];

async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
  } else {
    await new Promise<void>((resolve) => {
      queue.push({ resolve });
    });
  }
  const now = Date.now();
  const elapsed = now - lastFetchMs;
  if (elapsed < MIN_SPACING_MS) {
    await new Promise<void>((r) => setTimeout(r, MIN_SPACING_MS - elapsed));
  }
  lastFetchMs = Date.now();
}

function releaseSlot() {
  activeCount--;
  const next = queue.shift();
  if (next) {
    activeCount++;
    next.resolve();
  }
}

async function fetchUpstream(
  key: string,
  z: string,
  x: string,
  y: string,
): Promise<CachedTile | null> {
  await acquireSlot();
  try {
    const tileSum = parseInt(x, 10) + parseInt(y, 10);
    const subdomain = SUBDOMAINS[tileSum % SUBDOMAINS.length];
    const url = `https://${subdomain}.api.tiles.openaip.net/api/data/openaip/${z}/${x}/${y}.pbf`;

    for (let attempt = 0; attempt < 2; attempt++) {
      lastFetchMs = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "x-openaip-api-key": OPENAIP_API_KEY,
            Accept: "application/x-protobuf",
          },
        });

        if (res.status === 429 && attempt === 0) {
          clearTimeout(timer);
          await new Promise<void>((r) => setTimeout(r, 2_000));
          continue;
        }

        if (res.status === 204 || res.status === 404) {
          clearTimeout(timer);
          const entry: CachedTile = { kind: "empty", ts: Date.now() };
          putCache(key, entry);
          return entry;
        }

        if (!res.ok) {
          clearTimeout(timer);
          return null;
        }

        // Keep the abort timer active while streaming the body — a
        // hung upstream can stall arrayBuffer() indefinitely otherwise.
        const data = await res.arrayBuffer();
        clearTimeout(timer);
        const entry: CachedTile = { kind: "data", data, ts: Date.now() };
        putCache(key, entry);
        return entry;
      } catch {
        clearTimeout(timer);
        return null;
      }
    }
    return null;
  } finally {
    releaseSlot();
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!OPENAIP_API_KEY) {
    return new NextResponse(null, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const z = request.nextUrl.searchParams.get("z");
  const x = request.nextUrl.searchParams.get("x");
  const y = request.nextUrl.searchParams.get("y");

  if (!z || !x || !y) {
    return NextResponse.json(
      { error: "Missing z, x, or y parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    !VALID_TILE_COORD.test(z) ||
    !VALID_TILE_COORD.test(x) ||
    !VALID_TILE_COORD.test(y)
  ) {
    return NextResponse.json(
      { error: "Invalid tile coordinates" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const zoomLevel = parseInt(z, 10);
  if (zoomLevel > 20) {
    return NextResponse.json(
      { error: "Zoom level out of range" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const maxCoord = 1 << zoomLevel;
  if (parseInt(x, 10) >= maxCoord || parseInt(y, 10) >= maxCoord) {
    return NextResponse.json(
      { error: "Tile coordinate out of range for zoom level" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const key = `${z}/${x}/${y}`;

  const cached = getCached(key);
  if (cached) {
    if (cached.kind === "empty") {
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
        },
      });
    }
    return new NextResponse(cached.data, {
      status: 200,
      headers: {
        "Content-Type": "application/x-protobuf",
        "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  let promise = inflight.get(key);
  if (!promise) {
    promise = fetchUpstream(key, z, x, y).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
  }

  const result = await promise;

  if (!result) {
    return new NextResponse(null, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (result.kind === "empty") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
      },
    });
  }

  return new NextResponse(result.data, {
    status: 200,
    headers: {
      "Content-Type": "application/x-protobuf",
      "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

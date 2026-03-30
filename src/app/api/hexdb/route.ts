import { type NextRequest, NextResponse } from "next/server";

// ── hexdb.io Proxy ─────────────────────────────────────────────────
//
// hexdb.io does NOT return Access-Control-Allow-Origin headers,
// so client-side fetches fail with CORS errors. This thin proxy
// forwards allowed requests to hexdb.io and returns the result.
//
// Allowed paths (validated to prevent SSRF):
//   - route/icao/{CALLSIGN}  → route lookup
//   - airport/icao/{ICAO}    → airport details
// ────────────────────────────────────────────────────────────────────

const HEXDB_BASE = "https://hexdb.io/api/v1";

/** Only allow known hexdb.io API paths */
const ALLOWED_PATH_RE = /^(route\/icao|airport\/icao)\/[A-Z0-9]{1,8}$/i;

const UPSTREAM_TIMEOUT_MS = 5_000;

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");

  if (!path || !ALLOWED_PATH_RE.test(path)) {
    return NextResponse.json(
      { error: "Invalid or missing path parameter" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${HEXDB_BASE}/${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const body = await res.text();

    return new NextResponse(body, {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, max-age=600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Upstream request failed" },
      { status: 502 },
    );
  }
}

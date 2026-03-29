import { NextRequest, NextResponse } from "next/server";

// ── METAR Proxy ────────────────────────────────────────────────────────
//
// Proxies METAR requests to NOAA Aviation Weather API.
// No API key required. Validates ICAO code to prevent SSRF.

const NOAA_BASE = "https://aviationweather.gov/api/data/metar";
const FETCH_TIMEOUT_MS = 8_000;

/** Only allow 4-letter ICAO codes (uppercase alpha). */
const VALID_ICAO = /^[A-Z]{4}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const icao = request.nextUrl.searchParams.get("icao")?.trim().toUpperCase();

  if (!icao || !VALID_ICAO.test(icao)) {
    return NextResponse.json(
      { error: "Invalid or missing 'icao' parameter (4-letter ICAO code)" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const url = `${NOAA_BASE}?ids=${encodeURIComponent(icao)}&format=json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: {
        // METAR updates every 30-60 min; 10-min cache + stale-while-revalidate.
        "Cache-Control":
          "public, max-age=600, s-maxage=600, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Upstream timeout" },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch METAR" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

// ── TAF Proxy ──────────────────────────────────────────────────────────
//
// Proxies Terminal Area Forecast (TAF) requests to the NOAA Aviation
// Weather API. Same upstream family as the METAR endpoint — no API key,
// validates the ICAO code to prevent SSRF, caches at the edge.

const NOAA_BASE = "https://aviationweather.gov/api/data/taf";
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
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: {
        // TAFs are issued every 6 hours (00/06/12/18 UTC). 15-min cache with
        // stale-while-revalidate keeps edge hits cheap while staying fresh.
        "Cache-Control":
          "public, max-age=900, s-maxage=900, stale-while-revalidate=900",
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
      { error: "Failed to fetch TAF" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

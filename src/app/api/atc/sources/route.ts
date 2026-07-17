import { NextResponse, type NextRequest } from "next/server";
import { getFeedsByIcao } from "@/lib/atc-feeds";
import { getAtcSourceRegistry } from "@/lib/atc-source-registry";

const MANIFEST_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/**
 * GET /api/atc/sources?icao=KJFK
 *
 * Returns client-safe playback candidates for the logical feeds at one
 * airport. Without an ICAO it returns provider attribution only.
 */
export async function GET(request: NextRequest) {
  const rawIcao = request.nextUrl.searchParams.get("icao");
  const registry = getAtcSourceRegistry();

  if (rawIcao === null || rawIcao.trim() === "") {
    return NextResponse.json(
      { providers: registry.providers },
      { headers: { "Cache-Control": MANIFEST_CACHE_CONTROL } },
    );
  }

  const icao = rawIcao.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) {
    return NextResponse.json(
      { error: "Invalid airport code." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sourcesByFeed = Object.fromEntries(
    getFeedsByIcao(icao).map((feed) => [
      feed.id,
      registry.sourcesByFeed[feed.id] ?? [],
    ]),
  );

  return NextResponse.json(
    { icao, providers: registry.providers, sourcesByFeed },
    { headers: { "Cache-Control": MANIFEST_CACHE_CONTROL } },
  );
}

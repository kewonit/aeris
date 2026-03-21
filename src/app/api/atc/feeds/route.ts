import { NextResponse, type NextRequest } from "next/server";
import { getFeedsByIcao, getIcaoCodesWithFeeds } from "@/lib/atc-feeds";
import {
  findNearbyAtcFeeds,
  lookupAtcFeeds,
  iataToIcao,
} from "@/lib/atc-lookup";

/**
 * GET /api/atc/feeds
 *
 * Feed lookup endpoint. Accepts:
 *   ?icao=KJFK          — feeds for a specific ICAO code
 *   ?iata=JFK           — feeds for a specific IATA code
 *   ?lat=40.6&lng=-73.8 — nearby feeds by coordinates
 *   ?lat=...&lng=...&radius=30 — with custom radius (nm)
 *
 * Returns static data from the feed database (no upstream calls).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const icao = searchParams.get("icao")?.trim().toUpperCase();
  const iata = searchParams.get("iata")?.trim().toUpperCase();
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const radiusStr = searchParams.get("radius");

  // Lookup by ICAO code
  if (icao) {
    if (!/^[A-Z]{4}$/.test(icao)) {
      return NextResponse.json(
        { error: "Invalid ICAO code. Must be exactly 4 uppercase letters." },
        { status: 400 },
      );
    }
    const feeds = getFeedsByIcao(icao);
    return NextResponse.json({ icao, feeds });
  }

  // Lookup by IATA code
  if (iata) {
    if (!/^[A-Z]{3}$/.test(iata)) {
      return NextResponse.json(
        { error: "Invalid IATA code. Must be exactly 3 uppercase letters." },
        { status: 400 },
      );
    }
    const resolvedIcao = iataToIcao(iata);
    const feeds = lookupAtcFeeds(iata);
    return NextResponse.json({ icao: resolvedIcao, iata, feeds });
  }

  // Lookup by coordinates
  if (latStr && lngStr) {
    const lat = Number(latStr);
    const lng = Number(lngStr);
    const radius = radiusStr ? Number(radiusStr) : 60;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return NextResponse.json(
        { error: "Invalid latitude. Must be between -90 and 90." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: "Invalid longitude. Must be between -180 and 180." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(radius) || radius < 1 || radius > 60) {
      return NextResponse.json(
        { error: "Invalid radius. Must be between 1 and 60 nautical miles." },
        { status: 400 },
      );
    }

    const results = findNearbyAtcFeeds(lat, lng, radius);
    return NextResponse.json({ results });
  }

  // No parameters — return list of available ICAO codes
  const available = getIcaoCodesWithFeeds();
  return NextResponse.json({
    message:
      "Use ?icao=KJFK, ?iata=JFK, or ?lat=40.6&lng=-73.8 to look up feeds.",
    availableAirports: available.length,
    codes: available,
  });
}

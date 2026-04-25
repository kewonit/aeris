import { type NextRequest, NextResponse } from "next/server";
import {
  normalizeRouteCallsign,
  resolveRouteFromOpenDatabasesDetailed,
} from "@/lib/route-resolver";

const ROUTE_HIT_CACHE_CONTROL =
  "public, max-age=300, s-maxage=900, stale-while-revalidate=1800";
const ROUTE_MISS_CACHE_CONTROL = "public, max-age=60, s-maxage=120";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const callsign = normalizeRouteCallsign(
    request.nextUrl.searchParams.get("callsign"),
  );

  if (!callsign) {
    return NextResponse.json(
      { error: "Invalid or missing callsign" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const resolution = await resolveRouteFromOpenDatabasesDetailed(callsign);
  const route = resolution.route;

  if (!route) {
    if (resolution.temporarilyUnavailable) {
      return NextResponse.json(
        {
          error: "Route lookup temporarily unavailable",
          callsign,
          sources: ["adsbdb", "hexdb"],
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        error: "Route unavailable",
        callsign,
        sources: ["adsbdb", "hexdb"],
      },
      {
        status: 404,
        headers: { "Cache-Control": ROUTE_MISS_CACHE_CONTROL },
      },
    );
  }

  return NextResponse.json(route, {
    status: 200,
    headers: { "Cache-Control": ROUTE_HIT_CACHE_CONTROL },
  });
}

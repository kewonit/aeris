import { type NextRequest, NextResponse } from "next/server";
import { normalizeRouteCallsign } from "@/lib/route-lookup";
import type { RouteLookupResponse } from "@/lib/route-lookup";
import { resolveReportedRoutes } from "@/lib/route-resolver";

// Responses depend on the callsign alone, so shared caches can serve them.
// The browser checks each route against the live aircraft position.
const ROUTE_HIT_CACHE_CONTROL =
  "public, max-age=300, s-maxage=900, stale-while-revalidate=300";
const ROUTE_MISS_CACHE_CONTROL = "public, max-age=60, s-maxage=120";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const callsign = normalizeRouteCallsign(
    request.nextUrl.searchParams.get("callsign"),
  );
  if (!callsign) {
    return NextResponse.json(
      { error: "Invalid or missing callsign" },
      { status: 400, headers: NO_STORE },
    );
  }

  const { routes, temporarilyUnavailable } =
    await resolveReportedRoutes(callsign);

  if (routes.length === 0) {
    return temporarilyUnavailable
      ? NextResponse.json(
          { error: "Route lookup temporarily unavailable", callsign },
          { status: 503, headers: NO_STORE },
        )
      : NextResponse.json(
          { error: "Route unavailable", callsign },
          { status: 404, headers: { "Cache-Control": ROUTE_MISS_CACHE_CONTROL } },
        );
  }

  const body: RouteLookupResponse = { ...routes[0], routes };
  return NextResponse.json(body, {
    headers: { "Cache-Control": ROUTE_HIT_CACHE_CONTROL },
  });
}

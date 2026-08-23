import { type NextRequest, NextResponse } from "next/server";
import {
  normalizeRouteCallsign,
  resolveRouteFromOpenDatabasesDetailed,
} from "@/lib/route-resolver";
import { normalizeRouteRequest } from "@/lib/route-lookup";

const ROUTE_HIT_CACHE_CONTROL =
  "public, max-age=300, s-maxage=300, stale-while-revalidate=300";
const ROUTE_MISS_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
const SOURCES = ["adsbdb", "hexdb", "opensky"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const callsign = normalizeRouteCallsign(
    request.nextUrl.searchParams.get("callsign"),
  );
  const latitudeValue = request.nextUrl.searchParams.get("latitude");
  const longitudeValue = request.nextUrl.searchParams.get("longitude");
  const latitude = latitudeValue === null ? Number.NaN : Number(latitudeValue);
  const longitude =
    longitudeValue === null ? Number.NaN : Number(longitudeValue);
  const altitudeValue = request.nextUrl.searchParams.get("altitudeMeters");
  const altitudeMeters = altitudeValue ? Number(altitudeValue) : null;
  const observationTimeValue =
    request.nextUrl.searchParams.get("observationTime");
  const observationTime =
    observationTimeValue === null ? Number.NaN : Number(observationTimeValue);
  const onGroundValue = request.nextUrl.searchParams.get("onGround");
  const context = callsign
    ? normalizeRouteRequest({
        callsign,
        icao24: request.nextUrl.searchParams.get("icao24") ?? "",
        latitude,
        longitude,
        altitudeMeters,
        onGround: onGroundValue === "1",
        observationTime,
      })
    : null;

  if (!context || (onGroundValue !== "0" && onGroundValue !== "1")) {
    return NextResponse.json(
      { error: "Invalid or missing route context" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const resolution = await resolveRouteFromOpenDatabasesDetailed(context);
  const route = resolution.route;

  if (!route) {
    if (resolution.temporarilyUnavailable) {
      return NextResponse.json(
        {
          error: "Route lookup temporarily unavailable",
          callsign: context.callsign,
          sources: SOURCES,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        error: "Route unavailable",
        callsign: context.callsign,
        sources: SOURCES,
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

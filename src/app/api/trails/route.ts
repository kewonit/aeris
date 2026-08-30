import { NextRequest, NextResponse } from "next/server";

import {
  fetchRelayJson,
  getRelayServerConfig,
} from "@/lib/relay/server-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const MAX_BBOX_AREA = 100;

function validBBox(value: string): boolean {
  const values = value.split(",").map(Number);
  if (
    values.length !== 4 ||
    !values.every(Number.isFinite)
  ) {
    return false;
  }
  const [west, south, east, north] = values;
  if (
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    south >= north
  ) {
    return false;
  }
  const width = east >= west ? east - west : east - west + 360;
  return width > 0 && width * (north - south) <= MAX_BBOX_AREA;
}

function boundedInteger(
  value: string | null,
  minimum: number,
  maximum: number,
): string | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? String(parsed)
    : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getRelayServerConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Authorized flight data source is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const bbox = request.nextUrl.searchParams.get("bbox")?.trim() ?? "";
  const window = boundedInteger(
    request.nextUrl.searchParams.get("window"),
    1,
    3_600,
  );
  const limit = boundedInteger(
    request.nextUrl.searchParams.get("limitPerAircraft"),
    2,
    720,
  );
  if (
    !validBBox(bbox) ||
    (request.nextUrl.searchParams.has("window") && !window) ||
    (request.nextUrl.searchParams.has("limitPerAircraft") && !limit)
  ) {
    return NextResponse.json(
      { error: "Invalid trail query" },
      { status: 400, headers: NO_STORE },
    );
  }

  const search = new URLSearchParams({ bbox });
  if (window) search.set("window", window);
  if (limit) search.set("limitPerAircraft", limit);

  try {
    const response = await fetchRelayJson(
      config,
      "/v1/trails",
      search,
      request.signal,
    );
    return NextResponse.json(response.payload, {
      status: response.status,
      headers: NO_STORE,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { error: timedOut ? "Trail request timed out" : "Trail request failed" },
      { status: timedOut ? 504 : 502, headers: NO_STORE },
    );
  }
}

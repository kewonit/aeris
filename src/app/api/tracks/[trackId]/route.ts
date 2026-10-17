import { NextRequest, NextResponse } from "next/server";

import {
  fetchRelayJson,
  getRelayServerConfig,
} from "@/lib/relay/server-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRACK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ trackId: string }> },
): Promise<NextResponse> {
  const config = getRelayServerConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Authorized flight data source is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const { trackId } = await context.params;
  const windowValue = request.nextUrl.searchParams.get("window");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const window = windowValue === null ? 3_600 : Number(windowValue);
  const limit = limitValue === null ? 720 : Number(limitValue);
  if (
    !TRACK_ID.test(trackId) ||
    !Number.isSafeInteger(window) ||
    window < 1 ||
    window > 3_600 ||
    !Number.isSafeInteger(limit) ||
    limit < 2 ||
    limit > 720
  ) {
    return NextResponse.json(
      { error: "Invalid track query" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const response = await fetchRelayJson(
      config,
      `/v1/tracks/${encodeURIComponent(trackId)}`,
      new URLSearchParams({ window: String(window), limit: String(limit) }),
      request.signal,
    );
    return NextResponse.json(response.payload, {
      status: response.status,
      headers: NO_STORE,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { error: timedOut ? "Track request timed out" : "Track request failed" },
      { status: timedOut ? 504 : 502, headers: NO_STORE },
    );
  }
}

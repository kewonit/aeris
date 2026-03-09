import { NextRequest, NextResponse } from "next/server";

const JETAPI_BASE = "https://www.jetapi.dev/api";
const FETCH_TIMEOUT_MS = 12_000;
const REG_REGEX = /^[A-Z0-9-]{2,10}$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const reg = request.nextUrl.searchParams.get("reg")?.trim();

  if (!reg || !REG_REGEX.test(reg)) {
    return NextResponse.json(
      { error: "Missing or invalid 'reg' parameter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const params = new URLSearchParams({
    reg,
    photos: "10",
    flights: "0",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${JETAPI_BASE}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Upstream error" },
        {
          status: upstream.status >= 500 ? 502 : upstream.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const data: unknown = await upstream.json();

    return NextResponse.json(data, {
      status: 200,
      headers: {
        "Cache-Control":
          "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    clearTimeout(timer);

    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Upstream timeout" },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { error: "Proxy error" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

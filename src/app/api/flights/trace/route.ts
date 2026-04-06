import { type NextRequest, NextResponse } from "next/server";

import { fetchServerTrace } from "@/lib/trails/source/server-trace-service";

const HEX_REGEX = /^[0-9a-f]{6}$/;

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hex = request.nextUrl.searchParams.get("hex")?.trim().toLowerCase();

  if (!hex || !HEX_REGEX.test(hex)) {
    return NextResponse.json(
      { error: "Invalid or missing 'hex' parameter" },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const result = await fetchServerTrace(hex);
  return NextResponse.json(result.payload, {
    status: result.status,
    headers: result.headers,
  });
}

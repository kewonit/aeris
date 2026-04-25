import { NextResponse, type NextRequest } from "next/server";
import { buildLegacyCityRedirectTarget } from "@/lib/city-routing";

export function proxy(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("city");
  const target = code
    ? buildLegacyCityRedirectTarget(code, request.nextUrl.searchParams)
    : null;

  if (!target) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL(target, request.url), 308);
}

export const config = {
  matcher: [
    {
      source: "/",
      has: [{ type: "query", key: "city" }],
    },
  ],
};

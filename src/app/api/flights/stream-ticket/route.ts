import { NextRequest, NextResponse } from "next/server";

import {
  consumeTicketIssueLimit,
  createStreamTicket,
  getStreamTicketConfig,
  validateTicketRequestOrigin,
} from "@/lib/relay/ticket";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = validateTicketRequestOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { error: "Same-origin request required" },
      { status: 403, headers: NO_STORE },
    );
  }

  const config = getStreamTicketConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Flight stream is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  if (!consumeTicketIssueLimit(request)) {
    return NextResponse.json(
      { error: "Too many stream ticket requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }

  const ticket = createStreamTicket(config, origin);
  return NextResponse.json(
    {
      ...ticket,
      attribution: config.attribution,
    },
    { headers: NO_STORE },
  );
}

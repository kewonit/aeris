import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import {
  AIRSPACE_DISABLED_HEADER,
  AIRSPACE_DISABLED_REASON,
} from "@/lib/airspace-config";

test("GET returns 204 when the OpenAIP airspace integration is not configured", async () => {
  const previous = process.env.OPENAIP_API_KEY;
  delete process.env.OPENAIP_API_KEY;

  try {
    const routeModule = await import("@/app/api/airspace-tiles/route");
    const request = new NextRequest(
      "https://aeris.edbn.me/api/airspace-tiles?z=8&x=41&y=97",
    );

    const response = await routeModule.GET(request);

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(
      response.headers.get(AIRSPACE_DISABLED_HEADER),
      AIRSPACE_DISABLED_REASON,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAIP_API_KEY;
    } else {
      process.env.OPENAIP_API_KEY = previous;
    }
  }
});

test("GET treats a blank OpenAIP API key as unconfigured", async () => {
  const previous = process.env.OPENAIP_API_KEY;
  process.env.OPENAIP_API_KEY = "   ";

  try {
    const routeModule = await import("@/app/api/airspace-tiles/route");
    const request = new NextRequest(
      "https://aeris.edbn.me/api/airspace-tiles?z=8&x=41&y=97",
    );

    const response = await routeModule.GET(request);

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get(AIRSPACE_DISABLED_HEADER),
      AIRSPACE_DISABLED_REASON,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAIP_API_KEY;
    } else {
      process.env.OPENAIP_API_KEY = previous;
    }
  }
});

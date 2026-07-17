import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function requestHeader(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

test("GET sends an app-identifying user agent to Planespotters and parses current JetAPI photos", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  let planespottersUserAgent: string | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);

    if (url === "https://api.planespotters.net/pub/photos/hex/ae1233") {
      planespottersUserAgent = requestHeader(init, "user-agent");
      return jsonResponse({
        photos: [
          {
            id: "1619136",
            thumbnail_large: {
              src: "https://t.plnspttrs.net/37298/1619136_280.jpg",
            },
            thumbnail: {
              src: "https://t.plnspttrs.net/37298/1619136_t.jpg",
            },
            link: "https://www.planespotters.net/photo/1619136?utm_source=api",
            photographer: "Matthias Becker",
          },
        ],
      });
    }

    if (url === "https://api.adsbdb.com/v0/aircraft/ae1233") {
      return jsonResponse({
        response: {
          aircraft: {
            registration: "03-3122",
            manufacturer: "Boeing",
            type: "C-17A Globemaster III",
            icao_type: "C17",
            registered_owner: "United States Air Force",
            url_photo: "https://airport-data.com/images/stale.jpg",
          },
        },
      });
    }

    if (
      url ===
      "https://www.jetapi.dev/api?reg=03-3122&photos=10&only_jp=true"
    ) {
      return jsonResponse({
        Reg: "03-3122",
        Images: [
          {
            Image: "https://cdn.jetphotos.com/full/example.jpg",
            Thumbnail: "https://cdn.jetphotos.com/400/example.jpg",
            Link: "https://www.jetphotos.com/photo/11848786",
            Photographer: "FOC Radix Isatidis",
            Location: "Honolulu Int'l Airport - PHNL",
            DateTaken: "Sep 18, 2025",
          },
        ],
      });
    }

    if (
      url ===
      "https://www.airport-data.com/api/ac_thumb.json?m=03-3122&n=5"
    ) {
      return jsonResponse({}, { status: 404 });
    }

    return jsonResponse({}, { status: 404 });
  }) as typeof fetch;

  try {
    const routeModule = await import("@/app/api/aircraft-photos/route");
    const request = new NextRequest(
      "https://aeris.edbn.me/api/aircraft-photos?hex=AE1233&reg=03-3122",
    );

    const response = await routeModule.GET(request);
    const body = (await response.json()) as {
      photos: Array<{ id: string; url: string }>;
      aircraft: { registration: string } | null;
    };

    assert.equal(response.status, 200);
    assert.match(planespottersUserAgent ?? "", /^AerisFlightTracker\//);
    assert.equal(body.aircraft?.registration, "03-3122");
    assert.equal(body.photos[0]?.url, "https://cdn.jetphotos.com/full/example.jpg");
    assert.equal(body.photos[1]?.url, "https://t.plnspttrs.net/37298/1619136_280.jpg");
    assert.equal(
      urls.some((url) => url.startsWith("https://hexdb.io/api/v1/aircraft/")),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET uses adsbdb registration metadata for registration-based photo providers", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url === "https://api.planespotters.net/pub/photos/hex/abcdef") {
      return jsonResponse({ photos: [] });
    }

    if (url === "https://api.adsbdb.com/v0/aircraft/abcdef") {
      return jsonResponse({
        response: {
          aircraft: {
            registration: "RA-89031",
            manufacturer: "Sukhoi",
            type: "Superjet 100-95B",
            icao_type: "SU95",
            registered_owner: "Rossiya",
          },
        },
      });
    }

    if (url === "https://hexdb.io/api/v1/aircraft/abcdef") {
      return jsonResponse({
        Registration: "N00000",
        Manufacturer: "Fallback",
      });
    }

    if (
      url ===
      "https://www.jetapi.dev/api?reg=RA-89031&photos=10&only_jp=true"
    ) {
      return jsonResponse({
        Reg: "RA-89031",
        Images: [{ Image: "https://cdn.jetphotos.com/full/ra.jpg" }],
      });
    }

    if (
      url ===
        "https://www.airport-data.com/api/ac_thumb.json?m=RA-89031&n=5" ||
      url === "https://api.planespotters.net/pub/photos/reg/RA-89031"
    ) {
      return jsonResponse({ photos: [] });
    }

    return jsonResponse({}, { status: 404 });
  }) as typeof fetch;

  try {
    const routeModule = await import("@/app/api/aircraft-photos/route");
    const request = new NextRequest(
      "https://aeris.edbn.me/api/aircraft-photos?hex=abcdef",
    );

    const response = await routeModule.GET(request);
    const body = (await response.json()) as {
      photos: Array<{ url: string }>;
      aircraft: { registration: string; manufacturer: string | null } | null;
    };

    assert.equal(response.status, 200);
    assert.equal(body.aircraft?.registration, "RA-89031");
    assert.equal(body.aircraft?.manufacturer, "Sukhoi");
    assert.equal(body.photos[0]?.url, "https://cdn.jetphotos.com/full/ra.jpg");
    assert.ok(
      urls.includes(
        "https://www.jetapi.dev/api?reg=RA-89031&photos=10&only_jp=true",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

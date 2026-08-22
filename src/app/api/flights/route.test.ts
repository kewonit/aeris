import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET } from "./route";

function request(path: string, provider?: string): NextRequest {
  const url = new URL("http://localhost/api/flights");
  url.searchParams.set("path", path);
  if (provider) url.searchParams.set("provider", provider);
  return new NextRequest(url);
}

function readsbEnvelope() {
  return { ac: [], msg: "No error", now: 1, total: 0 };
}

test("constructs provider URLs and sends identifying headers", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input.toString(),
      headers: new Headers(init?.headers),
    });
    return Response.json(readsbEnvelope());
  };

  try {
    assert.equal(
      (await GET(request("/point/12.5/77.6/25.5", "adsb"))).status,
      200,
    );
    assert.equal(
      (await GET(request("/point/60.3179/24.9496/25", "adsbfi"))).status,
      200,
    );
    assert.equal(
      (await GET(request("/hex/461e1a", "adsbfi"))).status,
      200,
    );
    assert.equal(
      (await GET(request("/hex/abc123", "airplanes"))).status,
      200,
    );

    assert.equal(
      calls[0].url,
      "https://api.adsb.lol/v2/point/12.5/77.6/25.5",
    );
    assert.equal(
      calls[1].url,
      "https://opendata.adsb.fi/api/v3/lat/60.3179/lon/24.9496/dist/25",
    );
    assert.equal(
      calls[2].url,
      "https://opendata.adsb.fi/api/v2/hex/461e1a",
    );
    assert.equal(
      calls[3].url,
      "https://api.airplanes.live/v2/hex/abc123",
    );
    for (const call of calls) {
      assert.equal(call.headers.get("accept"), "application/json");
      assert.match(
        call.headers.get("user-agent") ?? "",
        /^AerisFlightTracker\//,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects invalid providers, geographic bounds, and SSRF paths", async () => {
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return Response.json(readsbEnvelope());
  };

  try {
    const cases: Array<[string, string?]> = [
      ["/point/90.1/0/1"],
      ["/point/0/180.1/1"],
      ["/point/0/0/250.1"],
      ["/point/0/0/-1"],
      ["https://example.com/v2/hex/abc123"],
      ["/hex/abc123/../../status"],
      ["/hex/abc123", "__proto__"],
    ];

    for (const [path, provider] of cases) {
      assert.equal((await GET(request(path, provider))).status, 400);
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed and non-JSON upstream responses", async (t) => {
  const originalFetch = globalThis.fetch;

  try {
    await t.test("malformed JSON", async () => {
      globalThis.fetch = async () =>
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      assert.equal((await GET(request("/hex/abc123", "adsb"))).status, 502);
    });

    await t.test("HTML challenge", async () => {
      globalThis.fetch = async () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      assert.equal(
        (await GET(request("/hex/abc123", "airplanes"))).status,
        502,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps timeouts and upstream HTTP failures correctly", async (t) => {
  const originalFetch = globalThis.fetch;

  try {
    await t.test("timeout", async () => {
      globalThis.fetch = async () => {
        throw new DOMException("Aborted", "AbortError");
      };
      assert.equal((await GET(request("/hex/abc123", "adsb"))).status, 504);
    });

    for (const [upstream, expected] of [
      [401, 401],
      [403, 403],
      [429, 429],
      [500, 502],
      [503, 502],
    ] as const) {
      await t.test(`${upstream} -> ${expected}`, async () => {
        globalThis.fetch = async () => new Response(null, { status: upstream });
        assert.equal(
          (await GET(request("/callsign/BAW123", "adsb"))).status,
          expected,
        );
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

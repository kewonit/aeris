import { NextRequest, NextResponse } from "next/server";

// ── RainViewer Weather Tile Proxy ──────────────────────────────────────
//
// Proxies radar tile requests to RainViewer's tile cache.  This avoids
// CORS issues (MapLibre GL JS v5 loads raster tiles via fetch() in a
// web worker, which requires CORS headers that RainViewer doesn't send).
//
// Query params:  ts (timestamp), z, x, y
// Upstream URL:
//   https://tilecache.rainviewer.com/v2/radar/{ts}/256/{z}/{x}/{y}/2/1_1.png
//
// Tiles are cached by the browser (10 min max-age).
// ────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8_000;
const VALID_COORD = /^[0-9]{1,3}$/;
const VALID_TIMESTAMP = /^[0-9]{8,12}$/;

const TRANSPARENT_1x1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQIHWNgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualzQAAAABJRU5ErkJggg==",
  "base64",
);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const ts = searchParams.get("ts");
  const z = searchParams.get("z");
  const x = searchParams.get("x");
  const y = searchParams.get("y");

  if (!ts || !z || !x || !y) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  if (
    !VALID_TIMESTAMP.test(ts) ||
    !VALID_COORD.test(z) ||
    !VALID_COORD.test(x) ||
    !VALID_COORD.test(y)
  ) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const url = `https://tilecache.rainviewer.com/v2/radar/${ts}/256/${z}/${x}/${y}/2/1_1.png`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      // Return transparent 1x1 PNG for missing tiles (no data = no rain)
      return new NextResponse(TRANSPARENT_1x1_PNG, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=600",
        },
      });
    }

    const data = await res.arrayBuffer();

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch {
    return new NextResponse(TRANSPARENT_1x1_PNG, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60",
      },
    });
  }
}

import { type NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for the ADS-B.fi API.
 *
 * The ADS-B.fi open API does not set CORS headers, so browser-side fetch()
 * is blocked. This route forwards the request server-side and relays the
 * response, adding the necessary CORS headers for the client.
 *
 * Route: GET /api/flights?lat=&lon=&dist=
 */

const ADSBFI_API = "https://opendata.adsb.fi/api/v3";
const FETCH_TIMEOUT_MS = 14_000;

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const lat = searchParams.get("lat");
    const lon = searchParams.get("lon");
    const dist = searchParams.get("dist");

    if (!lat || !lon || !dist) {
        return NextResponse.json(
            { error: "Missing required parameters: lat, lon, dist" },
            { status: 400 },
        );
    }

    // Validate numeric inputs to prevent SSRF
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const distNum = parseInt(dist, 10);

    if (
        !Number.isFinite(latNum) ||
        !Number.isFinite(lonNum) ||
        !Number.isFinite(distNum) ||
        Math.abs(latNum) > 90 ||
        Math.abs(lonNum) > 180 ||
        distNum < 1 ||
        distNum > 250
    ) {
        return NextResponse.json(
            { error: "Invalid parameter values" },
            { status: 400 },
        );
    }

    const upstreamUrl = `${ADSBFI_API}/lat/${latNum}/lon/${lonNum}/dist/${distNum}`;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const upstream = await fetch(upstreamUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "aeris-mercosul/1.0 (flight-tracker)",
            },
            next: { revalidate: 0 }, // always fresh
        });

        clearTimeout(timer);

        if (upstream.status === 429) {
            return NextResponse.json(
                { error: "Rate limited by upstream" },
                { status: 429 },
            );
        }

        if (!upstream.ok) {
            return NextResponse.json(
                { error: `Upstream error: ${upstream.status}` },
                { status: upstream.status },
            );
        }

        const data = await upstream.json();
        return NextResponse.json(data, {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
        }
        return NextResponse.json(
            { error: "Failed to fetch flight data" },
            { status: 502 },
        );
    }
}

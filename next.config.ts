import type { NextConfig } from "next";

import { getDirectTraceProviderPolicies } from "./src/lib/trails/providers";

const isDev = process.env.NODE_ENV === "development";

export function getFlightDataConnectSrc(
  environment: Record<string, string | undefined> = process.env,
): string[] {
  const result = new Set<string>();
  if (environment.NEXT_PUBLIC_AUTHORIZED_DIRECT_FLIGHT_DATA === "true") {
    result.add("https://opensky-network.org");
    result.add("https://api.airplanes.live");
    result.add("https://api.adsb.lol");
    for (const provider of getDirectTraceProviderPolicies()) {
      result.add(new URL(provider.baseUrl).origin);
    }
  }

  const streamUrl = environment.NEXT_PUBLIC_FLIGHT_STREAM_URL?.trim();
  if (streamUrl) {
    try {
      const parsed = new URL(streamUrl);
      if (
        (parsed.protocol === "wss:" || parsed.protocol === "ws:") &&
        !parsed.username &&
        !parsed.password
      ) {
        result.add(parsed.origin);
      }
    } catch {
      // Invalid public configuration is ignored so it cannot weaken CSP.
    }
  }
  return [...result];
}

const flightDataConnectSrc = getFlightDataConnectSrc().join(" ");

// Content Security Policy - allows only the external resources Aeris actually uses.
// https://nextjs.org/docs/app/guides/content-security-policy
//
// NOTE: planespotters.net, airport-data.com, and jetapi.dev are
// server-side only (accessed via /api/aircraft-photos proxy route). CSP does
// not apply to server-side fetches, so they are not listed in connect-src.
// adsbdb.com and hexdb.io are server-side only for route lookup via /api/routes.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https: ;
  font-src 'self';
  connect-src 'self' data: https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://server.arcgisonline.com https://s3.amazonaws.com https://tile.opentopomap.org https://www.google-analytics.com https://www.googletagmanager.com https://api.github.com https://res.cloudinary.com https://api.rainviewer.com ${flightDataConnectSrc};
  worker-src 'self' blob:;
  child-src blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';${isDev ? "" : "\n  upgrade-insecure-requests;"}
`;

const nextConfig: NextConfig = {
  transpilePackages: [
    "@deck.gl/core",
    "@deck.gl/layers",
    "@deck.gl/geo-layers",
    "@deck.gl/mesh-layers",
    "@deck.gl/mapbox",
    "@deck.gl/react",
    "@loaders.gl/core",
    "@loaders.gl/gltf",
    "@luma.gl/core",
    "@luma.gl/webgl",
  ],
  images: {
    remotePatterns: [
      { hostname: "a.basemaps.cartocdn.com" },
      { hostname: "server.arcgisonline.com" },
      { hostname: "tile.opentopomap.org" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspHeader.replace(/\s{2,}/g, " ").trim(),
          },
          ...(isDev
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
          },
        ],
      },
      {
        source: "/api/((?!routes(?:/|$)).*)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

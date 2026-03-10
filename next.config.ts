import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Content Security Policy — allows only the external resources Aeris actually uses.
// https://nextjs.org/docs/app/guides/content-security-policy
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https: ;
  font-src 'self';
  connect-src 'self' data: https://opensky-network.org https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://server.arcgisonline.com https://s3.amazonaws.com https://tile.opentopomap.org https://www.google-analytics.com https://www.googletagmanager.com https://api.github.com https://hexdb.io;
  worker-src 'self' blob:;
  child-src blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
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
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/api/:path*",
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

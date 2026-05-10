import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aeris - Real-Time 3D Flight Tracking",
    short_name: "Aeris",
    description:
      "Track live flights in 3D over the world's busiest airspaces. Altitude-aware, beautifully rendered, and completely free.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
    categories: ["travel", "navigation", "utilities"],
  };
}

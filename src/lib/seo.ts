export const SITE_NAME = "Aeris";
export const SITE_URL = "https://aeris.edbn.me";
export const DEFAULT_TITLE = "Aeris - Real-Time 3D Flight Tracking";
export const DEFAULT_DESCRIPTION =
  "Track live flights in stunning 3D over the world's busiest airspaces. See real-time ADS-B data with altitude-aware rendering - low altitudes glow cyan, high altitudes shift to gold. Free and open source.";

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

import type { TrailProviderId } from "./types";

export type TraceProviderId = Extract<
  TrailProviderId,
  "adsb-fi" | "adsb-lol" | "airplanes-live"
>;

export type TraceProviderPolicy = {
  id: TraceProviderId;
  baseUrl: string;
  supportsBrowserDirect: boolean;
  proxyHeaders: {
    origin: string;
    referer: string;
  } | null;
};

export const TRACE_PROVIDER_POLICIES: readonly TraceProviderPolicy[] = [
  {
    id: "airplanes-live",
    baseUrl: "https://globe.airplanes.live/data/traces",
    supportsBrowserDirect: true,
    proxyHeaders: {
      origin: "https://globe.airplanes.live",
      referer: "https://globe.airplanes.live/",
    },
  },
  {
    id: "adsb-fi",
    baseUrl: "https://globe.adsb.fi/data/traces",
    supportsBrowserDirect: false,
    proxyHeaders: {
      origin: "https://globe.adsb.fi",
      referer: "https://globe.adsb.fi/",
    },
  },
  {
    id: "adsb-lol",
    baseUrl: "https://globe.adsb.lol/data/traces",
    supportsBrowserDirect: false,
    proxyHeaders: null,
  },
] as const;

export function getTraceProviderPolicy(
  providerId: TraceProviderId,
): TraceProviderPolicy {
  const policy = TRACE_PROVIDER_POLICIES.find(
    (provider) => provider.id === providerId,
  );
  if (!policy) {
    throw new Error(`Unknown trace provider: ${providerId}`);
  }
  return policy;
}

export function getDirectTraceProviderPolicies(): TraceProviderPolicy[] {
  return TRACE_PROVIDER_POLICIES.filter(
    (provider) => provider.supportsBrowserDirect,
  );
}

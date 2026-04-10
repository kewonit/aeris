import { parseRateLimitInfo } from "@/lib/opensky-parsing";
import type {
  FlightTrack,
  OpenSkyTrackResponse,
  TrackWaypoint,
} from "@/lib/opensky-types";
import { OPENSKY_API } from "@/lib/opensky-types";

import { getTraceProviderPolicy, type TraceProviderId } from "../providers";
import type { TrailOutcome } from "../types";
import {
  normalizeTrackWaypoints,
  parseReadsbTrace,
} from "./parse-readsb-trace";

const TRACE_TIMEOUT_MS = 5_000;
const OPENSKY_TIMEOUT_MS = 5_000;
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const OPENSKY_TOKEN_REFRESH_MARGIN_MS = 30_000;
const SUCCESS_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=15";
const MISS_CACHE_CONTROL = "private, max-age=30";
const APP_UA = "Aeris/1.0 (flight-tracker; +https://github.com/kewonit/aeris)";

const TRACE_PROVIDER_ORDER: readonly TraceProviderId[] = [
  "adsb-fi",
  "adsb-lol",
  "airplanes-live",
] as const;

let preferredProviderId: TraceProviderId = TRACE_PROVIDER_ORDER[0];
let openskyTokenCache: {
  accessToken: string | null;
  expiresAtMs: number;
} = {
  accessToken: null,
  expiresAtMs: 0,
};

export type ProxyProviderId = TraceProviderId | "opensky";

export type ServerTracePayload = {
  hex: string;
  track: FlightTrack | null;
  source: ProxyProviderId | null;
  outcome: TrailOutcome;
  creditsRemaining: number | null;
  retryAfterSeconds: number | null;
  validators: {
    etag: string | null;
    lastModified: string | null;
  } | null;
};

export type ServerTraceResult = {
  status: number;
  headers: Record<string, string>;
  payload: ServerTracePayload;
};

export function createOpenSkyCooldownMs(params: {
  retryAfterHeader: string | null;
}): number {
  const raw = Number.parseFloat(params.retryAfterHeader ?? "");
  if (!Number.isFinite(raw) || raw <= 0) {
    return 60_000;
  }
  return Math.round(raw * 1000);
}

export function preferNextProvider(
  current: ProxyProviderId,
  succeeding: ProxyProviderId,
): ProxyProviderId {
  return succeeding === current ? current : succeeding;
}

function makeTraceUrls(providerId: TraceProviderId, icao24: string): string[] {
  const policy = getTraceProviderPolicy(providerId);
  const normalized = icao24.trim().toLowerCase();
  if (!/^[a-f0-9]{6}$/.test(normalized)) return [];
  const suffix = normalized.slice(-2);

  return [
    `${policy.baseUrl}/${suffix}/trace_full_${normalized}.json`,
    `${policy.baseUrl}/${suffix}/trace_recent_${normalized}.json`,
  ];
}

function buildHeaders(
  cacheControl: string,
  options?: {
    retryAfterSeconds?: number | null;
    validators?: { etag: string | null; lastModified: string | null } | null;
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": cacheControl,
  };

  if (options?.retryAfterSeconds && options.retryAfterSeconds > 0) {
    headers["Retry-After"] = String(options.retryAfterSeconds);
  }
  if (options?.validators?.etag) {
    headers.ETag = options.validators.etag;
  }
  if (options?.validators?.lastModified) {
    headers["Last-Modified"] = options.validators.lastModified;
  }

  return headers;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReadsbTrace(
  icao24: string,
  providerId: TraceProviderId,
): Promise<ServerTraceResult | null> {
  const policy = getTraceProviderPolicy(providerId);
  const requestHeaders = new Headers({
    Accept: "application/json",
    "User-Agent": APP_UA,
  });

  if (policy.proxyHeaders) {
    requestHeaders.set("Origin", policy.proxyHeaders.origin);
    requestHeaders.set("Referer", policy.proxyHeaders.referer);
  }

  const urls: Array<{
    url: string;
    outcome: Extract<TrailOutcome, "full-history" | "partial-history">;
  }> = makeTraceUrls(providerId, icao24).map((url, index) => ({
    url,
    outcome: index === 0 ? "full-history" : "partial-history",
  }));

  for (const candidate of urls) {
    try {
      const response = await fetchWithTimeout(
        candidate.url,
        {
          headers: requestHeaders,
          cache: "no-store",
        },
        TRACE_TIMEOUT_MS,
      );

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        contentType.includes("text/html") ||
        contentType.includes("text/xml")
      ) {
        continue;
      }

      const payload = (await response.json()) as unknown;
      const track = parseReadsbTrace(icao24, payload);
      if (!track || track.path.length < 2) {
        continue;
      }

      const validators = {
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };

      return {
        status: 200,
        headers: buildHeaders(SUCCESS_CACHE_CONTROL, { validators }),
        payload: {
          hex: icao24,
          track,
          source: providerId,
          outcome: candidate.outcome,
          creditsRemaining: null,
          retryAfterSeconds: null,
          validators,
        },
      };
    } catch {
      // Try the next URL/provider.
    }
  }

  return null;
}

export function parseOpenSkyTrack(
  icao24: string,
  payload: unknown,
): FlightTrack | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const data = payload as OpenSkyTrackResponse;
  const callsignRaw =
    typeof data.callsign === "string"
      ? data.callsign
      : typeof data.calllsign === "string"
        ? data.calllsign
        : null;
  const callsign = callsignRaw ? callsignRaw.trim() || null : null;
  const rawPath = Array.isArray(data.path) ? data.path : [];

  const path: TrackWaypoint[] = [];
  let lastLng: number | null = null;
  let lastLat: number | null = null;

  for (const entry of rawPath) {
    if (!Array.isArray(entry) || entry.length < 6) {
      continue;
    }

    const time =
      typeof entry[0] === "number" && Number.isFinite(entry[0])
        ? entry[0]
        : null;
    const rawLat =
      typeof entry[1] === "number" && Number.isFinite(entry[1])
        ? entry[1]
        : null;
    const rawLng =
      typeof entry[2] === "number" && Number.isFinite(entry[2])
        ? entry[2]
        : null;
    const latitude =
      rawLat !== null && rawLat >= -90 && rawLat <= 90 ? rawLat : null;
    const longitude =
      rawLng !== null && rawLng >= -180 && rawLng <= 180 ? rawLng : null;
    const baroAltitude =
      typeof entry[3] === "number" && Number.isFinite(entry[3])
        ? entry[3]
        : null;
    const trueTrack =
      typeof entry[4] === "number" && Number.isFinite(entry[4])
        ? entry[4]
        : null;
    const onGround = entry[5] === true;

    if (time === null || latitude === null || longitude === null) {
      continue;
    }
    if (lastLng === longitude && lastLat === latitude) {
      continue;
    }

    path.push({
      time,
      latitude,
      longitude,
      baroAltitude,
      trueTrack,
      onGround,
    });
    lastLng = longitude;
    lastLat = latitude;
  }

  if (path.length < 2) {
    return null;
  }

  const normalizedPath = normalizeTrackWaypoints(path);
  if (normalizedPath.length < 2) {
    return null;
  }

  return {
    icao24,
    startTime: Math.floor(normalizedPath[0].time),
    endTime: Math.floor(normalizedPath[normalizedPath.length - 1].time),
    callsign,
    path: normalizedPath,
  };
}

async function getOpenSkyAccessToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }

  const now = Date.now();
  if (
    openskyTokenCache.accessToken &&
    now < openskyTokenCache.expiresAtMs - OPENSKY_TOKEN_REFRESH_MARGIN_MS
  ) {
    return openskyTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetchWithTimeout(
    OPENSKY_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": APP_UA,
      },
      body,
      cache: "no-store",
    },
    OPENSKY_TIMEOUT_MS,
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token : null;
  const expiresInSeconds =
    typeof payload.expires_in === "number" &&
    Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 1_800;

  if (!accessToken) {
    return null;
  }

  openskyTokenCache = {
    accessToken,
    expiresAtMs: now + expiresInSeconds * 1_000,
  };

  return accessToken;
}

async function fetchOpenSkyTrace(icao24: string): Promise<ServerTraceResult> {
  const accessToken = await getOpenSkyAccessToken();
  if (!accessToken) {
    return {
      status: 200,
      headers: buildHeaders(MISS_CACHE_CONTROL),
      payload: {
        hex: icao24,
        track: null,
        source: null,
        outcome: "provider-unavailable",
        creditsRemaining: null,
        retryAfterSeconds: null,
        validators: null,
      },
    };
  }

  const response = await fetchWithTimeout(
    `${OPENSKY_API}/tracks/all?icao24=${encodeURIComponent(icao24)}&time=0`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": APP_UA,
      },
    },
    OPENSKY_TIMEOUT_MS,
  ).catch(() => null);

  if (!response) {
    return {
      status: 200,
      headers: buildHeaders(MISS_CACHE_CONTROL),
      payload: {
        hex: icao24,
        track: null,
        source: null,
        outcome: "provider-unavailable",
        creditsRemaining: null,
        retryAfterSeconds: null,
        validators: null,
      },
    };
  }

  const rateLimitInfo = parseRateLimitInfo(response);

  if (response.status === 429) {
    const retryAfterSeconds = rateLimitInfo.retryAfterSeconds ?? 60;
    return {
      status: 429,
      headers: buildHeaders("no-store", { retryAfterSeconds }),
      payload: {
        hex: icao24,
        track: null,
        source: "opensky",
        outcome: "rate-limited",
        creditsRemaining: rateLimitInfo.creditsRemaining,
        retryAfterSeconds,
        validators: null,
      },
    };
  }

  if (!response.ok) {
    return {
      status: 200,
      headers: buildHeaders(MISS_CACHE_CONTROL),
      payload: {
        hex: icao24,
        track: null,
        source: null,
        outcome: "provider-unavailable",
        creditsRemaining: rateLimitInfo.creditsRemaining,
        retryAfterSeconds: null,
        validators: null,
      },
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html") || contentType.includes("text/xml")) {
    return {
      status: 200,
      headers: buildHeaders(MISS_CACHE_CONTROL),
      payload: {
        hex: icao24,
        track: null,
        source: null,
        outcome: "provider-unavailable",
        creditsRemaining: rateLimitInfo.creditsRemaining,
        retryAfterSeconds: null,
        validators: null,
      },
    };
  }

  const payload = (await response.json()) as unknown;
  const track = parseOpenSkyTrack(icao24, payload);
  if (!track || track.path.length < 2) {
    return {
      status: 200,
      headers: buildHeaders(MISS_CACHE_CONTROL),
      payload: {
        hex: icao24,
        track: null,
        source: null,
        outcome: "provider-unavailable",
        creditsRemaining: rateLimitInfo.creditsRemaining,
        retryAfterSeconds: null,
        validators: null,
      },
    };
  }

  return {
    status: 200,
    headers: buildHeaders(SUCCESS_CACHE_CONTROL),
    payload: {
      hex: icao24,
      track,
      source: "opensky",
      outcome: "partial-history",
      creditsRemaining: rateLimitInfo.creditsRemaining,
      retryAfterSeconds: null,
      validators: null,
    },
  };
}

export async function fetchServerTrace(
  icao24: string,
): Promise<ServerTraceResult> {
  const normalized = icao24.trim().toLowerCase();
  const providerOrder = [
    preferredProviderId,
    ...TRACE_PROVIDER_ORDER.filter(
      (provider) => provider !== preferredProviderId,
    ),
  ];

  for (const providerId of providerOrder) {
    const result = await fetchReadsbTrace(normalized, providerId);
    if (!result?.payload.track) {
      continue;
    }

    preferredProviderId = preferNextProvider(
      preferredProviderId,
      providerId,
    ) as TraceProviderId;
    return result;
  }

  return fetchOpenSkyTrace(normalized);
}

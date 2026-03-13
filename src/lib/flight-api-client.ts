// ── readsb API Client ────────────────────────────────────────────────
//
// 3-tier fallback: airplanes.live → adsb.lol proxy → OpenSky.
// Dev override: ?provider=airplanes|adsb|opensky in the URL.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "./opensky-types";
import type { ReadsbApiResponse } from "./flight-api-types";
import { MAX_RADIUS_NM, NM_PER_DEG_LAT } from "./flight-api-types";
import { parseAircraftList, type ParseOptions } from "./flight-api-parsing";
import {
  bboxFromCenter,
  fetchFlightsByBbox,
  fetchFlightByIcao24 as openskyFetchByIcao24,
} from "./opensky-flights";

// ── Types ──────────────────────────────────────────────────────────────

export type ProviderName = "airplanes" | "adsb" | "opensky" | "auto";

export interface FlightApiFetchResult {
  flights: FlightState[];
  rateLimited: boolean;
}

// ── Provider Override (dev testing) ────────────────────────────────────

export function getProviderOverride(): ProviderName {
  if (typeof window === "undefined") return "auto";
  const p = new URLSearchParams(window.location.search)
    .get("provider")
    ?.toLowerCase();
  if (p === "airplanes" || p === "adsb" || p === "opensky") return p;
  return "auto";
}

// ── Constants ──────────────────────────────────────────────────────────

const AIRPLANES_LIVE_BASE = "https://api.airplanes.live/v2";
const DIRECT_TIMEOUT_MS = 10_000;
const PROXY_TIMEOUT_MS = 15_000;

// Client-side rate limiter for direct airplanes.live (1 req/s + margin)
const DIRECT_RATE_MS = 1_100;
let lastDirectTime = 0;

// ── Internal Helpers ───────────────────────────────────────────────────

function degreesToNm(degrees: number): number {
  if (!Number.isFinite(degrees) || degrees <= 0) return 150;
  const nm = Math.round(degrees * NM_PER_DEG_LAT);
  return Math.min(Math.max(nm, 1), MAX_RADIUS_NM);
}

/**
 * Runs `fn` with a timeout. External abort signals are propagated.
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) throw new DOMException("Aborted", "AbortError");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort);

  try {
    return await fn(controller.signal);
  } catch (err) {
    // If the external signal fired, surface as AbortError
    if (externalSignal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function validateReadsb(payload: unknown): ReadsbApiResponse {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as ReadsbApiResponse).ac)
  ) {
    throw new Error("Invalid readsb response shape");
  }
  return payload as ReadsbApiResponse;
}

// ── Tier 1: Direct to airplanes.live ───────────────────────────────────
//
// Avoid headers that trigger CORS preflight (Cache-Control, Pragma, etc.)
// since airplanes.live returns 405 for OPTIONS. Use cache-busting query
// param instead of cache: "no-store".

async function fetchDirectAirplanesLive(
  path: string,
  signal?: AbortSignal,
): Promise<ReadsbApiResponse> {
  // Client-side rate limiting (per-user IP)
  const elapsed = Date.now() - lastDirectTime;
  const wait = Math.max(0, DIRECT_RATE_MS - elapsed);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }
  lastDirectTime = Date.now();

  return withTimeout(
    async (innerSignal) => {
      const sep = path.includes("?") ? "&" : "?";
      const url = `${AIRPLANES_LIVE_BASE}${path}${sep}_t=${Date.now()}`;

      const res = await fetch(url, { signal: innerSignal });
      if (!res.ok) throw new Error(`airplanes.live ${res.status}`);

      return validateReadsb(await res.json());
    },
    DIRECT_TIMEOUT_MS,
    signal,
  );
}

// ── Tier 2: adsb.lol via server proxy ──────────────────────────────────

async function fetchViaProxy(
  path: string,
  signal?: AbortSignal,
): Promise<ReadsbApiResponse> {
  return withTimeout(
    async (innerSignal) => {
      const url = `/api/flights?path=${encodeURIComponent(path)}`;
      const res = await fetch(url, { cache: "no-store", signal: innerSignal });

      if (!res.ok) throw new Error(`adsb.lol proxy ${res.status}`);

      return validateReadsb(await res.json());
    },
    PROXY_TIMEOUT_MS,
    signal,
  );
}

// ── Tier 3: OpenSky direct ─────────────────────────────────────────────

async function fetchFromOpenSkyPoint(
  lat: number,
  lon: number,
  radiusDeg: number,
  signal?: AbortSignal,
): Promise<FlightState[]> {
  const [lamin, lamax, lomin, lomax] = bboxFromCenter(lon, lat, radiusDeg);
  const result = await fetchFlightsByBbox(lamin, lamax, lomin, lomax, signal);
  if (result.rateLimited) throw new Error("OpenSky rate limited (429)");
  return result.flights;
}

// ── Fallback Engine ────────────────────────────────────────────────────

type TierFn = () => Promise<FlightState[]>;

async function runFallbackChain(
  tiers: TierFn[],
  signal?: AbortSignal,
): Promise<FlightApiFetchResult> {
  let lastError: Error | null = null;

  for (const tier of tiers) {
    try {
      const flights = await tier();
      return { flights, rateLimited: false };
    } catch (err) {
      // If the caller aborted, stop immediately — no fallback
      if (signal?.aborted) throw err;
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // If the last error was rate-limiting, signal it
  const msg = lastError?.message?.toLowerCase() ?? "";
  if (msg.includes("429") || msg.includes("rate limit")) {
    return { flights: [], rateLimited: true };
  }

  throw lastError ?? new Error("All flight providers failed");
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Fetch flights within a radius of a geographic point.
 * Uses the 3-tier fallback chain: airplanes.live → adsb.lol → OpenSky.
 */
export async function fetchFlightsByPoint(
  lat: number,
  lon: number,
  radiusDeg: number,
  signal?: AbortSignal,
  options?: ParseOptions,
): Promise<FlightApiFetchResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { flights: [], rateLimited: false };
  }

  const radiusNm = degreesToNm(radiusDeg);
  const cLat = Math.max(-90, Math.min(90, lat));
  const cLon = Math.max(-180, Math.min(180, lon));
  const readsbPath = `/point/${cLat.toFixed(4)}/${cLon.toFixed(4)}/${radiusNm}`;

  const override = getProviderOverride();
  const tiers: TierFn[] = [];

  if (override === "auto" || override === "airplanes") {
    tiers.push(async () => {
      const resp = await fetchDirectAirplanesLive(readsbPath, signal);
      return parseAircraftList(resp.ac, options);
    });
  }

  if (override === "auto" || override === "adsb") {
    tiers.push(async () => {
      const resp = await fetchViaProxy(readsbPath, signal);
      return parseAircraftList(resp.ac, options);
    });
  }

  if (override === "auto" || override === "opensky") {
    tiers.push(() => fetchFromOpenSkyPoint(cLat, cLon, radiusDeg, signal));
  }

  return runFallbackChain(tiers, signal);
}

/**
 * Fetch a single aircraft by ICAO24 hex address.
 * Tries: airplanes.live → adsb.lol → OpenSky.
 */
export async function fetchFlightByHex(
  icao24: string,
  signal?: AbortSignal,
): Promise<{ flight: FlightState | null }> {
  const normalized = icao24.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return { flight: null };
  }

  const parseOpts: ParseOptions = {
    includeGround: true,
    requireBaroAltitude: false,
  };
  const readsbPath = `/hex/${encodeURIComponent(normalized)}`;
  const override = getProviderOverride();
  const tiers: TierFn[] = [];

  if (override === "auto" || override === "airplanes") {
    tiers.push(async () => {
      const resp = await fetchDirectAirplanesLive(readsbPath, signal);
      return parseAircraftList(resp.ac, parseOpts);
    });
  }

  if (override === "auto" || override === "adsb") {
    tiers.push(async () => {
      const resp = await fetchViaProxy(readsbPath, signal);
      return parseAircraftList(resp.ac, parseOpts);
    });
  }

  if (override === "auto" || override === "opensky") {
    tiers.push(async () => {
      const result = await openskyFetchByIcao24(normalized, signal);
      return result.flight ? [result.flight] : [];
    });
  }

  try {
    const result = await runFallbackChain(tiers, signal);
    return { flight: result.flights[0] ?? null };
  } catch {
    return { flight: null };
  }
}

/**
 * Fetch flights matching a callsign.
 * Tries: airplanes.live → adsb.lol (no OpenSky — callsign search costs 4 credits).
 */
export async function fetchFlightByCallsign(
  callsign: string,
  signal?: AbortSignal,
): Promise<{ flight: FlightState | null }> {
  const normalized = callsign.trim().toUpperCase();
  if (!normalized) return { flight: null };

  const parseOpts: ParseOptions = {
    includeGround: true,
    requireBaroAltitude: false,
  };
  const readsbPath = `/callsign/${encodeURIComponent(normalized)}`;
  const override = getProviderOverride();
  const tiers: TierFn[] = [];

  if (override === "auto" || override === "airplanes") {
    tiers.push(async () => {
      const resp = await fetchDirectAirplanesLive(readsbPath, signal);
      return parseAircraftList(resp.ac, parseOpts);
    });
  }

  if (override === "auto" || override === "adsb") {
    tiers.push(async () => {
      const resp = await fetchViaProxy(readsbPath, signal);
      return parseAircraftList(resp.ac, parseOpts);
    });
  }

  // No OpenSky tier: callsign search queries all aircraft (4-credit global fetch)

  try {
    const result = await runFallbackChain(tiers, signal);
    return { flight: result.flights[0] ?? null };
  } catch {
    return { flight: null };
  }
}

// ── readsb API Client ────────────────────────────────────────────────
//
// 3-tier fallback: adsb.lol proxy → airplanes.live proxy → OpenSky.
// Dev/override: ?provider=airplanes|adsb|opensky in the URL.
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
  source?: string;
}

// ── Circuit Breaker ────────────────────────────────────────────────────
//
// Prevents hammering a dead provider. After 3 consecutive non-abort,
// non-rate-limit failures the circuit OPENS — the tier is skipped for a
// cooldown window. After the window elapses the state transitions to
// HALF-OPEN and a single probe request is allowed through:
//   • probe succeeds → CLOSED (reset)
//   • probe fails    → OPEN (cooldown doubles, capped at 5 min)
//
// What counts as a failure:
//   ✓ Timeout, HTTP 5xx, non-JSON response, network error
//   ✗ AbortError (tab switch / navigation)
//   ✗ 429 rate-limit (server is alive, handled separately)
// ────────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

interface TierCircuit {
  state: CircuitState;
  failures: number;
  /** Timestamp after which OPEN → HALF-OPEN */
  openUntil: number;
}

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_BASE_COOLDOWN_MS = 60_000; // 60 s
const CIRCUIT_MAX_COOLDOWN_MS = 300_000; // 5 min

const circuits = new Map<string, TierCircuit>();

function shouldSkipTier(tierId: string): boolean {
  const c = circuits.get(tierId);
  if (!c || c.state === "closed") return false;
  if (c.state === "open" && Date.now() >= c.openUntil) {
    // Cooldown expired — allow one probe
    c.state = "half-open";
    return false;
  }
  return c.state === "open";
}

function recordSuccess(tierId: string): void {
  circuits.set(tierId, { state: "closed", failures: 0, openUntil: 0 });
}

function recordFailure(tierId: string): void {
  const c = circuits.get(tierId) ?? {
    state: "closed" as CircuitState,
    failures: 0,
    openUntil: 0,
  };
  c.failures++;
  if (c.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    // Cooldown: 60s → 120s → 240s → 300s …
    const exponent = c.failures - CIRCUIT_FAILURE_THRESHOLD;
    const cooldown = Math.min(
      CIRCUIT_BASE_COOLDOWN_MS * Math.pow(2, exponent),
      CIRCUIT_MAX_COOLDOWN_MS,
    );
    c.state = "open";
    c.openUntil = Date.now() + cooldown;
  }
  circuits.set(tierId, c);
}

/** Returns true if this error should NOT trip the circuit breaker. */
function isNonCircuitError(err: unknown): boolean {
  // Abort = tab switch / navigation — not a provider failure
  if (err instanceof DOMException && err.name === "AbortError") return true;
  // 429 = server is alive, just rate-limiting — already handled via rateLimited flag
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) return true;
  return false;
}

// ── Circuit State API (for UI consumption) ─────────────────────────────

/** Read the circuit breaker state for a specific tier. */
export function getCircuitState(tierId: string): {
  state: CircuitState;
  failures: number;
  cooldownRemaining: number;
} {
  const c = circuits.get(tierId);
  if (!c || c.state === "closed")
    return { state: "closed", failures: 0, cooldownRemaining: 0 };
  return {
    state: c.state,
    failures: c.failures,
    cooldownRemaining: Math.max(0, c.openUntil - Date.now()),
  };
}

/** Reset all circuits (e.g. on network reconnect). */
export function resetAllCircuits(): void {
  circuits.clear();
}

let _onlineListenerRegistered = false;
if (typeof window !== "undefined" && !_onlineListenerRegistered) {
  _onlineListenerRegistered = true;
  window.addEventListener("online", resetAllCircuits);
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

const PROXY_TIMEOUT_MS = 8_000;

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

// ── Tier 1 / Tier 2: readsb via server proxy ──────────────────────────
//
// Server proxy supports ?provider=adsb|airplanes.
// Airplanes.live is Tier 1 (richest data: registration, type, description).
// adsb.lol is Tier 2 (community-run, generous limits).

async function fetchViaProxy(
  path: string,
  provider: "adsb" | "airplanes" = "adsb",
  signal?: AbortSignal,
): Promise<ReadsbApiResponse> {
  return withTimeout(
    async (innerSignal) => {
      const url = `/api/flights?path=${encodeURIComponent(path)}&provider=${provider}`;
      const res = await fetch(url, { cache: "no-store", signal: innerSignal });

      if (!res.ok) throw new Error(`${provider} proxy ${res.status}`);

      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/html") || ct.includes("text/xml")) {
        throw new Error(`${provider} proxy returned non-JSON response`);
      }

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

interface NamedTier {
  id: string;
  fn: () => Promise<FlightState[]>;
}

// ── Sticky Source ──────────────────────────────────────────────────────
//
// After a provider succeeds, prefer it for STICKY_WINDOW_MS before
// trying higher-priority tiers again. This prevents unnecessary
// flip-flopping between providers when both are healthy.

const STICKY_WINDOW_MS = 60_000; // 60 s
let stickySource: string | null = null;
let stickyUntil = 0;

function recordStickySuccess(tierId: string): void {
  stickySource = tierId;
  stickyUntil = Date.now() + STICKY_WINDOW_MS;
}

async function runFallbackChain(
  tiers: NamedTier[],
  signal?: AbortSignal,
): Promise<FlightApiFetchResult> {
  let lastError: Error | null = null;
  let allSkipped = true;
  let lastTriedId: string | undefined;

  // If we have a sticky source and it's still within the window,
  // try it first before the normal tier order.
  const orderedTiers =
    stickySource && Date.now() < stickyUntil
      ? [
          ...tiers.filter((t) => t.id === stickySource),
          ...tiers.filter((t) => t.id !== stickySource),
        ]
      : tiers;

  for (const { id, fn } of orderedTiers) {
    if (shouldSkipTier(id)) continue;
    allSkipped = false;
    lastTriedId = id;

    try {
      const flights = await fn();
      recordSuccess(id);
      recordStickySuccess(id);
      return { flights, rateLimited: false, source: id };
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof DOMException && err.name === "AbortError") throw err;

      if (!isNonCircuitError(err)) recordFailure(id);

      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (allSkipped) {
    return { flights: [], rateLimited: false, source: "none" };
  }

  const msg = lastError?.message?.toLowerCase() ?? "";
  if (msg.includes("429") || msg.includes("rate limit")) {
    return { flights: [], rateLimited: true, source: lastTriedId };
  }

  throw lastError ?? new Error("All flight providers failed");
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Fetch flights within a radius of a geographic point.
 * Uses the fallback chain: adsb.lol proxy → airplanes.live proxy → OpenSky.
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
  const tiers: NamedTier[] = [];

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy — primary data source
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseAircraftList(resp.ac, options);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy — secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseAircraftList(resp.ac, options);
      },
    });
  }

  if (override === "auto") {
    // OpenSky — last resort
    tiers.push({
      id: "opensky",
      fn: () => fetchFromOpenSkyPoint(cLat, cLon, radiusDeg, signal),
    });
  }

  if (override === "opensky") {
    tiers.push({
      id: "opensky",
      fn: () => fetchFromOpenSkyPoint(cLat, cLon, radiusDeg, signal),
    });
  }

  return runFallbackChain(tiers, signal);
}

/**
 * Fetch a single aircraft by ICAO24 hex address.
 * Uses the fallback chain: adsb.lol proxy → airplanes.live proxy → OpenSky.
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
  const tiers: NamedTier[] = [];

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy — primary data source
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseAircraftList(resp.ac, parseOpts);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy — secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseAircraftList(resp.ac, parseOpts);
      },
    });
  }

  if (override === "auto") {
    // OpenSky — last resort
    tiers.push({
      id: "opensky",
      fn: async () => {
        const result = await openskyFetchByIcao24(normalized, signal);
        return result.flight ? [result.flight] : [];
      },
    });
  }

  if (override === "opensky") {
    tiers.push({
      id: "opensky",
      fn: async () => {
        const result = await openskyFetchByIcao24(normalized, signal);
        return result.flight ? [result.flight] : [];
      },
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
 * No OpenSky tier: callsign search queries all aircraft (4-credit global fetch).
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
  const tiers: NamedTier[] = [];

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy — primary data source
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseAircraftList(resp.ac, parseOpts);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy — secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseAircraftList(resp.ac, parseOpts);
      },
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

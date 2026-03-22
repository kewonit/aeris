// ── readsb API Client ────────────────────────────────────────────────
//
// 2-tier fallback: adsb.lol proxy → OpenSky.
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
//   • probe fails    → OPEN (cooldown doubles, capped at 120 s)
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
const CIRCUIT_BASE_COOLDOWN_MS = 30_000; // 30 s
const CIRCUIT_MAX_COOLDOWN_MS = 120_000; // 2 min

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
    // Cooldown: 30s → 60s → 120s → 120s …
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

const AIRPLANES_LIVE_BASE = "https://api.airplanes.live/v2";
const DIRECT_TIMEOUT_MS = 10_000;
const PROXY_TIMEOUT_MS = 15_000;

// Client-side rate limiter for direct airplanes.live (1 req/s + margin).
// Uses a Promise chain to serialize slot acquisition — concurrent callers
// queue up instead of both reading the same timestamp and firing together.
const DIRECT_RATE_MS = 1_100;
let lastDirectTime = 0;
let rateQueue: Promise<void> = Promise.resolve();

async function acquireDirectSlot(): Promise<void> {
  const slot = rateQueue.then(async () => {
    const elapsed = Date.now() - lastDirectTime;
    const wait = Math.max(0, DIRECT_RATE_MS - elapsed);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastDirectTime = Date.now();
  });
  rateQueue = slot;
  await slot;
}

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
  // Serialized rate limiting — concurrent callers queue up
  await acquireDirectSlot();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  return withTimeout(
    async (innerSignal) => {
      const sep = path.includes("?") ? "&" : "?";
      const url = `${AIRPLANES_LIVE_BASE}${path}${sep}_t=${Date.now()}`;

      const res = await fetch(url, { signal: innerSignal });
      if (!res.ok) throw new Error(`airplanes.live ${res.status}`);

      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/html") || ct.includes("text/xml")) {
        throw new Error("airplanes.live returned non-JSON response");
      }

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

      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/html") || ct.includes("text/xml")) {
        throw new Error("adsb.lol proxy returned non-JSON response");
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

async function runFallbackChain(
  tiers: NamedTier[],
  signal?: AbortSignal,
): Promise<FlightApiFetchResult> {
  let lastError: Error | null = null;
  let allSkipped = true;
  let lastTriedId: string | undefined;

  for (const { id, fn } of tiers) {
    if (shouldSkipTier(id)) continue;
    allSkipped = false;
    lastTriedId = id;

    try {
      const flights = await fn();
      recordSuccess(id);
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
 * Uses the fallback chain: adsb.lol → OpenSky.
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

  // Skip direct airplanes.live in the browser — CORS blocks it.
  // Only attempt when explicitly overridden via ?provider=airplanes.
  if (override === "airplanes") {
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchDirectAirplanesLive(readsbPath, signal);
        return parseAircraftList(resp.ac, options);
      },
    });
  }

  if (override === "auto" || override === "adsb") {
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, signal);
        return parseAircraftList(resp.ac, options);
      },
    });
  }

  if (override === "auto" || override === "opensky") {
    tiers.push({
      id: "opensky",
      fn: () => fetchFromOpenSkyPoint(cLat, cLon, radiusDeg, signal),
    });
  }

  return runFallbackChain(tiers, signal);
}

/**
 * Fetch a single aircraft by ICAO24 hex address.
 * Uses the fallback chain: adsb.lol → OpenSky.
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

  if (override === "airplanes") {
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchDirectAirplanesLive(readsbPath, signal);
        return parseAircraftList(resp.ac, parseOpts);
      },
    });
  }

  if (override === "auto" || override === "adsb") {
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, signal);
        return parseAircraftList(resp.ac, parseOpts);
      },
    });
  }

  if (override === "auto" || override === "opensky") {
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
 * Uses: adsb.lol only (OpenSky callsign search costs 4 credits).
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

  if (override === "airplanes") {
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchDirectAirplanesLive(readsbPath, signal);
        return parseAircraftList(resp.ac, parseOpts);
      },
    });
  }

  if (override === "auto" || override === "adsb") {
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, signal);
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

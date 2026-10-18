// ── readsb API Client ────────────────────────────────────────────────
//
// Four providers: adsb.lol proxy, adsb.fi proxy, airplanes.live proxy and
// OpenSky. They are asked quickest-first, as learned from their recent
// answers, and a slow one is hedged: after a short wait the next is asked
// too and the first answer wins (provider-race.ts, provider-health.ts).
// Override: ?provider=airplanes|adsb|adsbfi|opensky in the URL.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "./opensky-types";
import type { ReadsbApiResponse } from "./flight-api-types";
import { MAX_RADIUS_NM, NM_PER_DEG_LAT } from "./flight-api-types";
import { parseAircraftList, type ParseOptions } from "./flight-api-parsing";
import {
  bboxFromCenter,
  fetchFlightsByBbox,
  fetchFlightByCallsign as openskyFetchByCallsign,
  fetchFlightByIcao24 as openskyFetchByIcao24,
} from "./opensky-flights";
import { providerHealth } from "./provider-health";
import { raceProviders, type Candidate } from "./provider-race";

// ── Types ──────────────────────────────────────────────────────────────

export type ProviderName =
  | "airplanes"
  | "adsb"
  | "adsbfi"
  | "opensky"
  | "auto";

export const PROVIDER_CHANGE_EVENT = "aeris:provider-change";

export interface FlightApiFetchResult {
  flights: FlightState[];
  rateLimited: boolean;
  source?: string;
}

// ── Circuit Breaker ────────────────────────────────────────────────────
//
// Prevents hammering a dead provider. After 3 consecutive non-abort,
// non-rate-limit failures the circuit OPENS - the tier is skipped for a
// cooldown window. After the window elapses the state transitions to
// HALF-OPEN and a single probe request is allowed through:
//   • probe succeeds → CLOSED (reset)
//   • probe fails    → OPEN (cooldown doubles, capped at 5 min)
//
// What counts as a failure:
//   ✓ Timeout, HTTP errors, non-JSON response, network error
//   ✓ 401/403 immediately open the circuit for the maximum cooldown
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
/** Point polls so far, for the periodic measuring pass. */
let pointPolls = 0;

class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} proxy ${status}`);
    this.name = "ProviderHttpError";
  }
}

function shouldSkipTier(tierId: string): boolean {
  const c = circuits.get(tierId);
  if (!c || c.state === "closed") return false;
  if (c.state === "open" && Date.now() >= c.openUntil) {
    // Cooldown expired - allow one probe
    c.state = "half-open";
    return false;
  }
  return c.state === "open";
}

function recordSuccess(tierId: string): void {
  circuits.set(tierId, { state: "closed", failures: 0, openUntil: 0 });
}

function recordFailure(tierId: string, err: unknown): void {
  const c = circuits.get(tierId) ?? {
    state: "closed" as CircuitState,
    failures: 0,
    openUntil: 0,
  };

  if (
    err instanceof ProviderHttpError &&
    (err.status === 401 || err.status === 403)
  ) {
    circuits.set(tierId, {
      state: "open",
      failures: Math.max(c.failures + 1, CIRCUIT_FAILURE_THRESHOLD),
      openUntil: Date.now() + CIRCUIT_MAX_COOLDOWN_MS,
    });
    return;
  }

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
  // Abort = tab switch / navigation - not a provider failure
  if (err instanceof Error && err.name === "AbortError") return true;
  // 429 = server is alive, just rate-limiting - already handled via rateLimited flag
  if (err instanceof ProviderHttpError && err.status === 429) return true;
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

/** Reset all circuits and what was learned about providers' speed. */
export function resetAllCircuits(): void {
  circuits.clear();
  providerHealth.reset();
  pointPolls = 0;
}

let _onlineListenerRegistered = false;
if (typeof window !== "undefined" && !_onlineListenerRegistered) {
  _onlineListenerRegistered = true;
  window.addEventListener("online", resetAllCircuits);
}

// ── Provider Override ──────────────────────────────────────────────────

export function getProviderOverride(): ProviderName {
  if (typeof window === "undefined") return "auto";
  const p = new URLSearchParams(window.location.search)
    .get("provider")
    ?.toLowerCase();
  if (
    p === "airplanes" ||
    p === "adsb" ||
    p === "adsbfi" ||
    p === "opensky"
  )
    return p;
  return "auto";
}

export function setProviderOverride(provider: ProviderName): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (provider === "auto") {
    url.searchParams.delete("provider");
  } else {
    url.searchParams.set("provider", provider);
  }

  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new Event(PROVIDER_CHANGE_EVENT));
}

// ── Constants ──────────────────────────────────────────────────────────

const PROXY_TIMEOUT_MS = 6_000;
/**
 * How long the provider in front gets before the next is asked as well.
 * A healthy provider answers well inside this; a slow one costs one extra
 * request and no longer holds the map up.
 */
const HEDGE_DELAY_MS = 1_200;
/**
 * Every so many point polls, every provider is asked at once, so that a
 * provider that has recovered is seen to be quick again and asked first.
 */
const MEASURE_EVERY_POLLS = 12;
const PROVIDER_LABELS = {
  adsb: "adsb.lol",
  adsbfi: "adsb.fi",
  airplanes: "airplanes.live",
} as const;

// ── Internal Helpers ───────────────────────────────────────────────────

function degreesToNm(degrees: number): number {
  if (!Number.isFinite(degrees) || degrees <= 0) return 150;
  const nm = Math.round(degrees * NM_PER_DEG_LAT);
  return Math.min(Math.max(nm, 1), MAX_RADIUS_NM);
}

/**
 * A provider that took too long. It is a failure of that provider, so the
 * fallback chain moves on; only the caller's own abort cancels the lookup.
 */
export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider did not answer within ${timeoutMs} ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Runs `fn` with a timeout. External abort signals are propagated as an
 * AbortError; the timeout itself raises a ProviderTimeoutError.
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) throw new DOMException("Aborted", "AbortError");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort);

  try {
    return await fn(controller.signal);
  } catch (err) {
    // If the external signal fired, surface as AbortError
    if (externalSignal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    if (timedOut) throw new ProviderTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function validateReadsb(payload: unknown): ReadsbApiResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid readsb response shape");
  }

  const response = payload as Partial<ReadsbApiResponse>;
  if (
    !Array.isArray(response.ac) ||
    typeof response.msg !== "string" ||
    typeof response.now !== "number" ||
    !Number.isFinite(response.now) ||
    typeof response.total !== "number" ||
    !Number.isFinite(response.total) ||
    (response.ctime !== undefined &&
      (typeof response.ctime !== "number" || !Number.isFinite(response.ctime))) ||
    (response.ptime !== undefined &&
      (typeof response.ptime !== "number" || !Number.isFinite(response.ptime)))
  ) {
    throw new Error("Invalid readsb response shape");
  }

  return response as ReadsbApiResponse;
}

// ── readsb providers via server proxy ─────────────────────────────────
//
// Server proxy supports ?provider=adsb|adsbfi|airplanes.
// adsb.lol is primary; adsb.fi and airplanes.live are fallbacks.

async function fetchViaProxy(
  path: string,
  provider: "adsb" | "adsbfi" | "airplanes" = "adsb",
  signal?: AbortSignal,
): Promise<ReadsbApiResponse> {
  return withTimeout(
    async (innerSignal) => {
      const url = `/api/flights?path=${encodeURIComponent(path)}&provider=${provider}`;
      const res = await fetch(url, { cache: "no-store", signal: innerSignal });

      if (!res.ok) throw new ProviderHttpError(provider, res.status);

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

function parseReadsbResponse(
  response: ReadsbApiResponse,
  provider: keyof typeof PROVIDER_LABELS,
  options?: ParseOptions,
): FlightState[] {
  return parseAircraftList(response.ac, {
    ...options,
    positionProvider: PROVIDER_LABELS[provider],
    responseTime: response.now,
  });
}

// ── Tier 4: OpenSky direct ─────────────────────────────────────────────

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
  fn: (signal: AbortSignal) => Promise<FlightState[]>;
}

interface FallbackOptions {
  /** A valid empty lookup is a miss, so continue to the next provider. */
  continueOnEmpty?: boolean;
  /** Ask every provider at once, to measure them all. */
  measureAll?: boolean;
}

function isRateLimit(err: Error): boolean {
  if (err instanceof ProviderHttpError && err.status === 429) return true;
  const msg = err.message.toLowerCase();
  return msg.includes("429") || msg.includes("rate limit");
}

/**
 * Asks the providers quickest-first, hedging a slow one with the next, and
 * answers with the first acceptable result. Only the caller's abort
 * cancels the lookup; a provider that timed out or failed is a failure of
 * that provider, counted against its circuit, and the race moves on.
 */
async function runFallbackChain(
  tiers: NamedTier[],
  signal?: AbortSignal,
  options?: FallbackOptions,
): Promise<FlightApiFetchResult> {
  const order = providerHealth.order(tiers.map((t) => t.id));
  const candidates: Candidate<FlightState[]>[] = [];
  for (const id of order) {
    if (shouldSkipTier(id)) continue;
    const tier = tiers.find((t) => t.id === id)!;
    candidates.push({ id, run: tier.fn });
  }

  if (candidates.length === 0) {
    return { flights: [], rateLimited: false, source: "none" };
  }

  // A measuring pass asks every proxied provider at once; OpenSky's
  // credits are only spent when the rest have failed.
  const startAtOnce = options?.measureAll
    ? candidates.filter((c) => c.id !== "opensky").length
    : 1;
  const outcome = await raceProviders(candidates, {
    hedgeDelayMs: HEDGE_DELAY_MS,
    accept: options?.continueOnEmpty
      ? (flights) => flights.length > 0
      : undefined,
    startAtOnce,
    signal,
  });

  for (const [id, latencyMs] of outcome.latencies) {
    recordSuccess(id);
    providerHealth.noteAnswer(id, latencyMs);
  }
  for (const { id, error } of outcome.failures) {
    if (isNonCircuitError(error)) continue;
    recordFailure(id, error);
    providerHealth.noteFailure(id);
  }

  if (outcome.winner) {
    const { id, value } = outcome.winner;
    return { flights: value, rateLimited: false, source: id };
  }

  const lastMiss = outcome.misses[outcome.misses.length - 1];
  if (lastMiss) {
    return { flights: [], rateLimited: false, source: lastMiss };
  }

  const rateLimited = outcome.failures.find((f) => isRateLimit(f.error));
  if (rateLimited) {
    return { flights: [], rateLimited: true, source: rateLimited.id };
  }

  const last = outcome.failures[outcome.failures.length - 1];
  throw last?.error ?? new Error("All flight providers failed");
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Fetch flights within a radius of a geographic point.
 * Asks the providers quickest-first and hedges a slow one with the next.
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
    // adsb.lol via proxy - primary data source
    tiers.push({
      id: "adsb",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseReadsbResponse(resp, "adsb", options);
      },
    });
  }

  if (override === "adsbfi" || override === "auto") {
    // adsb.fi via proxy - public secondary fallback
    tiers.push({
      id: "adsbfi",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "adsbfi", signal);
        return parseReadsbResponse(resp, "adsbfi", options);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy - secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseReadsbResponse(resp, "airplanes", options);
      },
    });
  }

  if (override === "auto") {
    // OpenSky - last resort
    tiers.push({
      id: "opensky",
      fn: (signal) => fetchFromOpenSkyPoint(cLat, cLon, radiusDeg, signal),
    });
  }

  if (override === "opensky") {
    tiers.push({
      id: "opensky",
      fn: (signal) => fetchFromOpenSkyPoint(cLat, cLon, radiusDeg, signal),
    });
  }

  pointPolls += 1;
  return runFallbackChain(tiers, signal, {
    measureAll: override === "auto" && pointPolls % MEASURE_EVERY_POLLS === 0,
  });
}

/**
 * Fetch all aircraft returned for an ICAO24 hex address.
 * Asks the providers quickest-first and hedges a slow one with the next.
 */
export async function fetchFlightsByHex(
  icao24: string,
  signal?: AbortSignal,
): Promise<FlightApiFetchResult> {
  const normalized = icao24.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return { flights: [], rateLimited: false };
  }

  const parseOpts: ParseOptions = {
    includeGround: true,
    requireBaroAltitude: false,
  };
  const readsbPath = `/hex/${encodeURIComponent(normalized)}`;
  const override = getProviderOverride();
  const tiers: NamedTier[] = [];

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy - primary data source
    tiers.push({
      id: "adsb",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseReadsbResponse(resp, "adsb", parseOpts);
      },
    });
  }

  if (override === "adsbfi" || override === "auto") {
    // adsb.fi via proxy - public secondary fallback
    tiers.push({
      id: "adsbfi",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "adsbfi", signal);
        return parseReadsbResponse(resp, "adsbfi", parseOpts);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy - secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseReadsbResponse(resp, "airplanes", parseOpts);
      },
    });
  }

  if (override === "auto") {
    // OpenSky - last resort
    tiers.push({
      id: "opensky",
      fn: async (signal) => {
        const result = await openskyFetchByIcao24(normalized, signal);
        return result.flight ? [result.flight] : [];
      },
    });
  }

  if (override === "opensky") {
    tiers.push({
      id: "opensky",
      fn: async (signal) => {
        const result = await openskyFetchByIcao24(normalized, signal);
        return result.flight ? [result.flight] : [];
      },
    });
  }

  try {
    return await runFallbackChain(tiers, signal, { continueOnEmpty: true });
  } catch {
    return { flights: [], rateLimited: false };
  }
}

/**
 * Fetch all aircraft matching a callsign.
 * Uses OpenSky only after all readsb providers miss or fail.
 */
export async function fetchFlightsByCallsign(
  callsign: string,
  signal?: AbortSignal,
): Promise<FlightApiFetchResult> {
  const normalized = callsign.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,8}$/.test(normalized)) {
    return { flights: [], rateLimited: false };
  }

  const parseOpts: ParseOptions = {
    includeGround: true,
    requireBaroAltitude: false,
  };
  const readsbPath = `/callsign/${encodeURIComponent(normalized)}`;
  const override = getProviderOverride();
  const tiers: NamedTier[] = [];

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy - primary data source
    tiers.push({
      id: "adsb",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseReadsbResponse(resp, "adsb", parseOpts);
      },
    });
  }

  if (override === "adsbfi" || override === "auto") {
    // adsb.fi via proxy - public secondary fallback
    tiers.push({
      id: "adsbfi",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "adsbfi", signal);
        return parseReadsbResponse(resp, "adsbfi", parseOpts);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy - secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async (signal) => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseReadsbResponse(resp, "airplanes", parseOpts);
      },
    });
  }

  if (override === "auto" || override === "opensky") {
    tiers.push({
      id: "opensky",
      fn: async (signal) => {
        const result = await openskyFetchByCallsign(normalized, signal);
        if (result.rateLimited) throw new Error("OpenSky rate limited (429)");
        return result.flight ? [result.flight] : [];
      },
    });
  }

  try {
    return await runFallbackChain(tiers, signal, { continueOnEmpty: true });
  } catch {
    return { flights: [], rateLimited: false };
  }
}

/** Fetch a single aircraft by ICAO24 while preserving the existing API. */
export async function fetchFlightByHex(
  icao24: string,
  signal?: AbortSignal,
): Promise<{ flight: FlightState | null }> {
  const result = await fetchFlightsByHex(icao24, signal);
  return { flight: result.flights[0] ?? null };
}

/** Fetch a single aircraft by callsign while preserving the existing API. */
export async function fetchFlightByCallsign(
  callsign: string,
  signal?: AbortSignal,
): Promise<{ flight: FlightState | null }> {
  const result = await fetchFlightsByCallsign(callsign, signal);
  return { flight: result.flights[0] ?? null };
}

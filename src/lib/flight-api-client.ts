// ── readsb API Client ────────────────────────────────────────────────
//
// The authorized relay is the normal source. A legacy provider chain is
// available only behind explicit server and browser authorization gates.
// ────────────────────────────────────────────────────────────────────────

import type { FlightState } from "./opensky-types";
import type { ReadsbApiResponse } from "./flight-api-types";
import {
  isRelayResponseMeta,
  type RelayAttribution,
  type RelaySourceStatus,
} from "./relay/protocol";
import { MAX_RADIUS_NM, NM_PER_DEG_LAT } from "./flight-api-types";
import { parseAircraftList, type ParseOptions } from "./flight-api-parsing";
import {
  bboxFromCenter,
  fetchFlightsByBbox,
  fetchFlightByCallsign as openskyFetchByCallsign,
  fetchFlightByIcao24 as openskyFetchByIcao24,
} from "./opensky-flights";

// ── Types ──────────────────────────────────────────────────────────────

export type ProviderName =
  | "relay"
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
  sourceStatus?: RelaySourceStatus;
  sourceAgeMs?: number | null;
  attribution?: RelayAttribution | null;
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

// Sticky preference is deliberately point-polling state only. One-off
// lookups and global searches must neither read nor update it.
const STICKY_WINDOW_MS = 60_000; // 60 s
let stickySource: string | null = null;
let stickyUntil = 0;

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

/** Reset all circuits (e.g. on network reconnect). */
export function resetAllCircuits(): void {
  circuits.clear();
  stickySource = null;
  stickyUntil = 0;
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
    p === "relay" ||
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

  stickySource = null;
  stickyUntil = 0;
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new Event(PROVIDER_CHANGE_EVENT));
}

// ── Constants ──────────────────────────────────────────────────────────

const PROXY_TIMEOUT_MS = 8_000;
const PROVIDER_LABELS = {
  relay: "aeris-relay",
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

  if (response.meta !== undefined && !isRelayResponseMeta(response.meta)) {
    throw new Error("Invalid relay response metadata");
  }

  return response as ReadsbApiResponse;
}

// ── readsb providers via server proxy ─────────────────────────────────
//
// Server proxy supports ?provider=adsb|adsbfi|airplanes.
// adsb.lol is primary; adsb.fi and airplanes.live are fallbacks.

async function fetchViaProxy(
  path: string,
  provider: "relay" | "adsb" | "adsbfi" | "airplanes" = "adsb",
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

      const response = validateReadsb(await res.json());
      if (provider === "relay" && response.meta === undefined) {
        throw new Error("Relay response metadata is required");
      }
      return response;
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
    positionProvider: response.meta ? "aeris-relay" : PROVIDER_LABELS[provider],
    responseTime: response.now,
  });
}

function relayFetchResult(
  response: ReadsbApiResponse,
  options?: ParseOptions,
): FlightApiFetchResult {
  const status = response.meta?.sourceStatus;
  const attribution = response.meta?.attribution;
  return {
    flights: parseReadsbResponse(response, "relay", {
      includeGround: options?.includeGround ?? true,
      requireBaroAltitude: options?.requireBaroAltitude ?? false,
      ...options,
    }),
    rateLimited: false,
    source: "relay",
    ...(status ? { sourceStatus: status } : {}),
    sourceAgeMs:
      typeof response.meta?.sourceAgeMs === "number" &&
      Number.isFinite(response.meta.sourceAgeMs)
        ? Math.max(0, response.meta.sourceAgeMs)
        : null,
    attribution:
      attribution && typeof attribution.provider === "string"
        ? {
            provider: attribution.provider,
            ...(typeof attribution.label === "string"
              ? { label: attribution.label }
              : {}),
            ...(typeof attribution.url === "string"
              ? { url: attribution.url }
              : {}),
          }
        : null,
  };
}

export function isRelayClientConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FLIGHT_STREAM_URL?.trim());
}

export function isDirectFlightDataClientAuthorized(): boolean {
  return process.env.NEXT_PUBLIC_AUTHORIZED_DIRECT_FLIGHT_DATA === "true";
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
  fn: () => Promise<FlightState[]>;
}

function recordStickySuccess(tierId: string): void {
  stickySource = tierId;
  stickyUntil = Date.now() + STICKY_WINDOW_MS;
}

interface FallbackOptions {
  /** A valid empty lookup is a miss, so continue to the next provider. */
  continueOnEmpty?: boolean;
  /** Only continuous point polling may use or update sticky preference. */
  usePointSticky?: boolean;
}

async function runFallbackChain(
  tiers: NamedTier[],
  signal?: AbortSignal,
  options?: FallbackOptions,
): Promise<FlightApiFetchResult> {
  let lastError: Error | null = null;
  let allSkipped = true;
  let lastTriedId: string | undefined;
  let lastEmptySource: string | undefined;

  const orderedTiers =
    options?.usePointSticky && stickySource && Date.now() < stickyUntil
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

      if (options?.continueOnEmpty && flights.length === 0) {
        lastEmptySource = id;
        continue;
      }

      if (options?.usePointSticky) recordStickySuccess(id);
      return { flights, rateLimited: false, source: id };
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof Error && err.name === "AbortError") throw err;

      if (!isNonCircuitError(err)) recordFailure(id, err);

      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (lastEmptySource) {
    return { flights: [], rateLimited: false, source: lastEmptySource };
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
 * Uses the fallback chain: adsb.lol proxy → adsb.fi proxy → airplanes.live proxy → OpenSky.
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

  if (isRelayClientConfigured() || override === "relay") {
    const response = await fetchViaProxy(readsbPath, "relay", signal);
    return relayFetchResult(response, options);
  }

  if (!isDirectFlightDataClientAuthorized()) {
    return { flights: [], rateLimited: false, source: "none" };
  }

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy - primary data source
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseReadsbResponse(resp, "adsb", options);
      },
    });
  }

  if (override === "adsbfi" || override === "auto") {
    // adsb.fi via proxy - public secondary fallback
    tiers.push({
      id: "adsbfi",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsbfi", signal);
        return parseReadsbResponse(resp, "adsbfi", options);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy - secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseReadsbResponse(resp, "airplanes", options);
      },
    });
  }

  if (override === "auto") {
    // OpenSky - last resort
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

  return runFallbackChain(tiers, signal, { usePointSticky: true });
}

/**
 * Fetch all aircraft returned for an ICAO24 hex address.
 * Uses the fallback chain: adsb.lol proxy → adsb.fi proxy → airplanes.live proxy → OpenSky.
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

  if (isRelayClientConfigured() || override === "relay") {
    try {
      const response = await fetchViaProxy(readsbPath, "relay", signal);
      return relayFetchResult(response, parseOpts);
    } catch {
      return { flights: [], rateLimited: false, source: "relay" };
    }
  }

  if (!isDirectFlightDataClientAuthorized()) {
    return { flights: [], rateLimited: false, source: "none" };
  }

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy - primary data source
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseReadsbResponse(resp, "adsb", parseOpts);
      },
    });
  }

  if (override === "adsbfi" || override === "auto") {
    // adsb.fi via proxy - public secondary fallback
    tiers.push({
      id: "adsbfi",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsbfi", signal);
        return parseReadsbResponse(resp, "adsbfi", parseOpts);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy - secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseReadsbResponse(resp, "airplanes", parseOpts);
      },
    });
  }

  if (override === "auto") {
    // OpenSky - last resort
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
    return await runFallbackChain(tiers, signal, { continueOnEmpty: true });
  } catch {
    return { flights: [], rateLimited: false };
  }
}

/** Fetch one fresh adsb.lol result for selected-aircraft fusion. */
export async function fetchSelectedAircraftFromAdsbLol(
  icao24: string,
  signal?: AbortSignal,
): Promise<FlightState | null> {
  const normalized = icao24.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(normalized)) return null;
  if (!isRelayClientConfigured() && !isDirectFlightDataClientAuthorized()) {
    return null;
  }

  try {
    const response = await fetchViaProxy(
      `/hex/${encodeURIComponent(normalized)}`,
      isRelayClientConfigured() ? "relay" : "adsb",
      signal,
    );
    return (
      parseReadsbResponse(response, isRelayClientConfigured() ? "relay" : "adsb", {
        includeGround: true,
        requireBaroAltitude: false,
      }).find((flight) => flight.icao24 === normalized) ?? null
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return null;
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

  if (isRelayClientConfigured() || override === "relay") {
    try {
      const response = await fetchViaProxy(readsbPath, "relay", signal);
      return relayFetchResult(response, parseOpts);
    } catch {
      return { flights: [], rateLimited: false, source: "relay" };
    }
  }

  if (!isDirectFlightDataClientAuthorized()) {
    return { flights: [], rateLimited: false, source: "none" };
  }

  if (override === "adsb" || override === "auto") {
    // adsb.lol via proxy - primary data source
    tiers.push({
      id: "adsb",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsb", signal);
        return parseReadsbResponse(resp, "adsb", parseOpts);
      },
    });
  }

  if (override === "adsbfi" || override === "auto") {
    // adsb.fi via proxy - public secondary fallback
    tiers.push({
      id: "adsbfi",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "adsbfi", signal);
        return parseReadsbResponse(resp, "adsbfi", parseOpts);
      },
    });
  }

  if (override === "airplanes" || override === "auto") {
    // airplanes.live via proxy - secondary fallback
    tiers.push({
      id: "airplanes",
      fn: async () => {
        const resp = await fetchViaProxy(readsbPath, "airplanes", signal);
        return parseReadsbResponse(resp, "airplanes", parseOpts);
      },
    });
  }

  if (override === "auto" || override === "opensky") {
    tiers.push({
      id: "opensky",
      fn: async () => {
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

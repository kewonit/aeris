"use client";

// ── Route Info Hook ─────────────────────────────────────────────────
//
// Fetches reported route data from external databases.
//
// Sources (queried in parallel server-side):
//   1. adsbdb.com       flight-plan database
//   2. hexdb.io         route lookup and airport metadata
//   3. OpenSky Network  historical route data
//
// The server checks the reported route against the aircraft position.
// It hides a route when the geometry conflicts.
//
// Edge cases handled:
//   - Rapid flight switching: old requests are cancelled, only the
//     latest callsign's result is applied.
//   - Component unmount: no state updates after unmount.
//   - Hanging fetch: 15-second client timeout guarantees loading
//     never gets stuck.
//   - Cached results: instant display for recently-looked-up routes.
// ────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { FlightState } from "@/lib/opensky";
import {
  lookupRoute,
  formatAirportCode,
  routeCacheKey,
  type RouteSource,
} from "@/lib/route-lookup";
import type { RouteInfo, RouteAirport } from "@/lib/route-lookup";

// ── Types ──────────────────────────────────────────────────────────────

export type FlightRouteInfo = {
  /** Origin airport from a reported route, or null */
  origin: RouteAirport | null;
  /** Destination airport from a reported route, or null */
  destination: RouteAirport | null;
  /** Whether route data is actively being fetched */
  loading: boolean;
  /** Whether a position-consistent reported route was found */
  available: boolean;
  /** Whether the route is definitively unknown (not just loading) */
  unavailable: boolean;
  /** Short display string, e.g. "LHR → JFK" */
  routeDisplay: string | null;
  /** Data source that resolved this route */
  source: "adsbdb" | "hexdb" | "opensky" | null;
  /** All route sources that returned the same endpoints */
  sources: RouteSource[];
  /** Time of the latest route validation */
  validatedAt: number | null;
};

const EMPTY_ROUTE: FlightRouteInfo = {
  origin: null,
  destination: null,
  loading: false,
  available: false,
  unavailable: false,
  routeDisplay: null,
  source: null,
  sources: [],
  validatedAt: null,
};

/** Max time to wait for a route lookup before forcing timeout. */
const LOOKUP_TIMEOUT_MS = 15_000;

// ── Hook ───────────────────────────────────────────────────────────────

export function useRouteInfo(flight: FlightState | null): FlightRouteInfo {
  const [apiRoute, setApiRoute] = useState<RouteInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);

  // Use a generation counter to ignore stale async results
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const callsign = flight?.callsign?.trim().toUpperCase() ?? null;
  const routeRequest = useMemo(
    () =>
      flight &&
      callsign &&
      flight.latitude !== null &&
      flight.longitude !== null
        ? {
            callsign,
            icao24: flight.icao24,
            latitude: flight.latitude,
            longitude: flight.longitude,
            altitudeMeters: flight.baroAltitude,
            onGround: flight.onGround,
            observationTime:
              flight.provenance.observationTime ??
              flight.provenance.responseTime,
          }
        : null,
    [callsign, flight],
  );
  const requestKey = routeRequest ? routeCacheKey(routeRequest) : null;
  const routeRequestRef = useRef(routeRequest);

  useEffect(() => {
    routeRequestRef.current = routeRequest;
  }, [routeRequest]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const activeRequest = routeRequestRef.current;
    if (!activeRequest || !requestKey) {
      const generation = ++generationRef.current;
      queueMicrotask(() => {
        if (!mountedRef.current) return;
        if (generation !== generationRef.current) return;
        setApiRoute(null);
        setIsLoading(false);
        setIsUnavailable(false);
      });
      return;
    }

    // Start a new lookup generation
    const generation = ++generationRef.current;
    let active = true;
    let settled = false;

    queueMicrotask(() => {
      if (!active) return;
      if (settled) return;
      if (!mountedRef.current) return;
      if (generation !== generationRef.current) return;
      setIsLoading(true);
      setIsUnavailable(false);
      setApiRoute(null);
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, LOOKUP_TIMEOUT_MS);

    lookupRoute(activeRequest, controller.signal)
      .then((result) => {
        settled = true;
        clearTimeout(timeoutId);
        if (!mountedRef.current) return;
        if (generation !== generationRef.current) return; // stale

        setApiRoute(result);
        setIsLoading(false);
        setIsUnavailable(result === null);
      })
      .catch(() => {
        settled = true;
        clearTimeout(timeoutId);
        if (!mountedRef.current) return;
        if (generation !== generationRef.current) return; // stale

        setApiRoute(null);
        setIsLoading(false);
        setIsUnavailable(true);
      });

    return () => {
      active = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [requestKey]);

  if (!flight) return EMPTY_ROUTE;

  const origin = apiRoute?.origin ?? null;
  const destination = apiRoute?.destination ?? null;
  const available = !!origin && !!destination;

  const originCode = origin ? formatAirportCode(origin) : null;
  const destCode = destination ? formatAirportCode(destination) : null;
  const routeDisplay =
    originCode && destCode ? `${originCode} → ${destCode}` : null;

  return {
    origin,
    destination,
    loading: isLoading,
    available,
    unavailable: isUnavailable,
    routeDisplay,
    source: apiRoute?.source ?? null,
    sources: apiRoute?.sources ?? [],
    validatedAt: apiRoute?.validatedAt ?? null,
  };
}

/** Imperatively clear the route lookup cache. */
export function useClearRouteCache() {
  const clear = useCallback(() => {
    // route-lookup cache is module-level; re-import to clear
    void import("@/lib/route-lookup").then((m) => m.clearRouteCache());
  }, []);
  return clear;
}

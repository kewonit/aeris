"use client";

// ── Route Info Hook ─────────────────────────────────────────────────
//
// Combines open route-database data with observed departure data
// information for a selected flight:
//
//   1. Free route database lookup (adsbdb.com → hexdb.io fallback)
//   2. Trace-based observed departure (first waypoint of trace)
//   3. Client-side observed departure (ground→airborne transition)
//
// Destination prediction is intentionally not used. If the open route
// databases do not know a destination, the UI should show a partial or
// unavailable route rather than inventing one.
//
// Only triggers API lookups for the *selected* flight to avoid
// spamming the API with requests for all visible aircraft.
// ────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from "react";
import type { FlightState, FlightTrack } from "@/lib/opensky";
import { lookupRoute, formatAirportCode } from "../lib/route-lookup";
import type { RouteInfo, RouteAirport } from "../lib/route-lookup";
import { getDeparture, departureFromTrace } from "@/lib/route-detection";

// ── Types ──────────────────────────────────────────────────────────────

export type FlightRouteInfo = {
  /** Origin airport (from route database, observed departure, or null) */
  origin: RouteAirport | null;
  /** Destination airport from route databases only */
  destination: RouteAirport | null;
  /** Confidence level for the destination */
  destinationConfidence: "known" | null;
  /** How the route was determined */
  source: "route-database" | "observed" | "mixed" | null;
  /** Whether route data is being fetched and no route info is available yet */
  loading: boolean;
  /** Short display string, e.g. "LHR → JFK" */
  routeDisplay: string | null;
};

const EMPTY_ROUTE: FlightRouteInfo = {
  origin: null,
  destination: null,
  destinationConfidence: null,
  source: null,
  loading: false,
  routeDisplay: null,
};

// ── Hook ───────────────────────────────────────────────────────────────

export function useRouteInfo(
  flight: FlightState | null,
  track?: FlightTrack | null,
): FlightRouteInfo {
  const [apiRoute, setApiRoute] = useState<RouteInfo | null>(null);
  const [apiRouteCallsign, setApiRouteCallsign] = useState<string | null>(null);
  const lastCallsignRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track the callsign to avoid re-fetching for the same flight
  const callsign = flight?.callsign?.trim().toUpperCase() ?? null;

  // Fetch route from API when callsign changes
  useEffect(() => {
    if (!callsign) {
      abortRef.current?.abort();
      lastCallsignRef.current = null;
      return;
    }

    // Same callsign → don't re-fetch
    if (callsign === lastCallsignRef.current) return;
    lastCallsignRef.current = callsign;

    // Abort any in-progress fetch
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    lookupRoute(callsign, controller.signal)
      .then((result: RouteInfo | null) => {
        if (!controller.signal.aborted) {
          setApiRoute(result);
          setApiRouteCallsign(callsign);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setApiRoute(null);
          setApiRouteCallsign(callsign);
        }
      });

    return () => {
      controller.abort();
    };
  }, [callsign]);

  // Build the composite route info
  const currentApiRoute =
    callsign && apiRouteCallsign === callsign ? apiRoute : null;

  return buildRouteInfo(
    flight,
    currentApiRoute,
    Boolean(callsign) && apiRouteCallsign !== callsign,
    track ?? null,
  );
}

// ── Composite Builder ──────────────────────────────────────────────────
//
// Merges data from all available sources to build the best possible
// route info. Each field (origin, destination) is filled independently
// using a priority cascade:
//
//   origin:      route API → trace departure → live departure detection
//   destination: route API only
//
// Destination prediction is intentionally excluded. If open route databases
// do not know the destination, the UI should show a partial or unavailable
// route rather than inventing one.

export function buildRouteInfo(
  flight: FlightState | null,
  apiRoute: RouteInfo | null,
  loading: boolean,
  track: FlightTrack | null,
): FlightRouteInfo {
  if (!flight) return EMPTY_ROUTE;

  // ── Gather origin candidates ───────────────────────────────────────
  const apiOrigin = apiRoute?.origin ?? null;
  const traceDeparture = departureFromTrace(track);
  const liveDeparture = getDeparture(flight.icao24);
  const liveOrigin = liveDeparture?.airport ?? null;

  // Treat route database data as a single route record. Observed departure
  // fills only when the database has no origin, and never creates a guessed
  // destination.
  const observedOrigin = traceDeparture ?? liveOrigin;
  const origin = apiOrigin ?? observedOrigin;

  // ── Gather destination candidates ──────────────────────────────────
  const apiDestination = apiRoute?.destination ?? null;
  const destination = apiDestination;

  // ── Determine confidence ───────────────────────────────────────────
  let destinationConfidence: FlightRouteInfo["destinationConfidence"] = null;
  if (apiDestination) {
    destinationConfidence = "known";
  }

  // ── Determine source label ─────────────────────────────────────────
  let source: FlightRouteInfo["source"] = null;
  if (origin || destination) {
    const hasApiData = !!apiOrigin || !!apiDestination;
    const usesObservedOrigin = !apiOrigin && !!observedOrigin;

    if (hasApiData && usesObservedOrigin) {
      source = "mixed";
    } else if (hasApiData) {
      source = "route-database";
    } else if (usesObservedOrigin) {
      source = "observed";
    } else {
      source = null;
    }
  }

  // ── Build display string ───────────────────────────────────────────
  const originCode = origin ? formatAirportCode(origin) : null;
  const destCode = destination ? formatAirportCode(destination) : null;
  const routeDisplay = buildRouteDisplay(originCode, destCode);

  if (!origin && !destination) {
    return { ...EMPTY_ROUTE, loading };
  }

  return {
    origin,
    destination,
    destinationConfidence,
    source,
    loading: loading && !origin && !destination,
    routeDisplay,
  };
}

// ── Display helpers ────────────────────────────────────────────────────

function buildRouteDisplay(
  originCode: string | null,
  destCode: string | null,
): string | null {
  if (originCode && destCode) return `${originCode} → ${destCode}`;
  if (originCode) return `From ${originCode}`;
  if (destCode) return `→ ${destCode}`;
  return null;
}

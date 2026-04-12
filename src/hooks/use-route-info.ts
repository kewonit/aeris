"use client";

// ── Route Info Hook ─────────────────────────────────────────────────
//
// Combines four data sources to provide the best possible route
// information for a selected flight:
//
//   1. API lookup (adsbdb.com combined endpoint → hexdb.io fallback)
//   2. Trace-based departure detection (first waypoint of trace)
//   3. Client-side departure detection (ground→airborne transition)
//   4. Client-side destination estimation (heading + altitude heuristic)
//
// All sources are combined — API data is supplemented (not replaced)
// by trace/detection data when the API is missing origin or destination.
//
// Only triggers API lookups for the *selected* flight to avoid
// spamming the API with requests for all visible aircraft.
// ────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from "react";
import type { FlightState, FlightTrack } from "@/lib/opensky";
import {
  lookupRoute,
  formatAirportCode,
  type RouteInfo,
  type RouteAirport,
} from "@/lib/route-lookup";
import {
  getDeparture,
  departureFromTrace,
  estimateDestination,
} from "@/lib/route-detection";

// ── Types ──────────────────────────────────────────────────────────────

export type FlightRouteInfo = {
  /** Origin airport (from API, departure detection, or null) */
  origin: RouteAirport | null;
  /** Destination airport (from API or estimation) */
  destination: RouteAirport | null;
  /** Confidence level for the destination */
  destinationConfidence: "known" | "high" | "medium" | "low" | null;
  /** How the route was determined */
  source: "api" | "detected" | "estimated" | "mixed" | null;
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
      .then((result) => {
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
//   origin:      trace departure  →  API  →  live departure detection
//   destination: API  →  heading/altitude estimation
//
// Trace-based departure is prioritised over API because the API returns
// schedule/historical route data for the callsign (e.g. "SG106 usually
// flies BOM→DEL") while the trace shows where THIS flight actually
// departed from (e.g. PNQ today).

function buildRouteInfo(
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

  // Priority: trace > API > live detection
  // Trace departure uses actual ADS-B waypoints near an airport, so it
  // reflects the real departure for THIS flight, not historical schedules.
  const origin = traceDeparture ?? apiOrigin ?? liveOrigin;

  // ── Gather destination candidates ──────────────────────────────────
  const apiDestination = apiRoute?.destination ?? null;
  const departureIata =
    (traceDeparture?.iata ?? apiOrigin?.iata ?? liveOrigin?.iata) || undefined;
  const estimate = estimateDestination(flight, departureIata);

  // Priority: API > heading estimation
  const destination = apiDestination ?? estimate?.airport ?? null;

  // ── Determine confidence ───────────────────────────────────────────
  let destinationConfidence: FlightRouteInfo["destinationConfidence"] = null;
  if (apiDestination) {
    destinationConfidence = "known";
  } else if (estimate) {
    destinationConfidence = estimate.confidence;
  }

  // ── Determine source label ─────────────────────────────────────────
  let source: FlightRouteInfo["source"] = null;
  if (origin || destination) {
    const originIsTrace = !!traceDeparture;
    const originIsApi = !originIsTrace && !!apiOrigin;
    const destIsApi = !!apiDestination;

    if (originIsApi && destIsApi) {
      source = "api";
    } else if (!originIsApi && !destIsApi) {
      if (traceDeparture || liveOrigin) source = "detected";
      else if (estimate) source = "estimated";
      else source = "detected";
    } else {
      source = "mixed";
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

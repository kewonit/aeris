"use client";

import { useEffect, useState } from "react";
import type { FlightState } from "@/lib/opensky";
import {
  lookupReportedRoutes,
  normalizeRouteCallsign,
  type ReportedRoute,
  type RouteAirport,
  type RouteSource,
} from "@/lib/route-lookup";
import { isSameLeg, selectReportedRoute } from "@/lib/route-validation";

export type FlightRouteInfo = {
  origin: RouteAirport | null;
  destination: RouteAirport | null;
  loading: boolean;
  /** A reported route exists and fits the aircraft's current position. */
  available: boolean;
  /** The lookup finished without a route that fits. */
  unavailable: boolean;
  /** Providers reported a route, but it does not fit the position. */
  mismatch: boolean;
  source: RouteSource | null;
};

/**
 * Looks up the routes providers report for the flight's callsign, then
 * keeps the leg that best fits the live position. The check reruns on
 * every position update, so the next leg takes over at a stop and a route
 * that stops fitting disappears, without another request.
 */
export function useRouteInfo(flight: FlightState | null): FlightRouteInfo {
  const callsign = normalizeRouteCallsign(flight?.callsign);
  const [lookup, setLookup] = useState<{
    callsign: string;
    routes: ReportedRoute[];
  } | null>(null);
  const [shown, setShown] = useState<{
    aircraft: string;
    route: ReportedRoute;
  } | null>(null);

  useEffect(() => {
    if (!callsign) return;
    let cancelled = false;
    void lookupReportedRoutes(callsign).then((routes) => {
      if (!cancelled) setLookup({ callsign, routes });
    });
    return () => {
      cancelled = true;
    };
  }, [callsign]);

  const routes = lookup?.callsign === callsign ? lookup.routes : null;
  const position =
    flight && flight.latitude !== null && flight.longitude !== null
      ? {
          latitude: flight.latitude,
          longitude: flight.longitude,
          altitudeMeters: flight.baroAltitude,
          onGround: flight.onGround,
          verticalRate: flight.verticalRate ?? flight.geomRate ?? null,
          track: flight.trueTrack,
          speed: flight.velocity,
        }
      : null;
  const aircraft = flight ? `${flight.icao24}:${callsign}` : null;
  const current = shown?.aircraft === aircraft ? shown.route : null;
  const route = routes ? selectReportedRoute(routes, position, current) : null;

  // Remember the leg shown, so it holds while it still fits.
  if (aircraft && route && !(current && isSameLeg(route, current))) {
    setShown({ aircraft, route });
  }

  return {
    origin: route?.origin ?? null,
    destination: route?.destination ?? null,
    loading: callsign !== null && routes === null,
    available: route !== null,
    unavailable: routes !== null && route === null,
    mismatch: routes !== null && routes.length > 0 && route === null,
    source: route?.source ?? null,
  };
}

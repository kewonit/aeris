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
import {
  isSameLeg,
  selectReportedRoute,
  takeoffAirport,
} from "@/lib/route-validation";
import { useTrailStoreSnapshot } from "@/lib/trails/store/trail-store";

export type FlightRouteInfo = {
  origin: RouteAirport | null;
  /** Null when only the departure is known. */
  destination: RouteAirport | null;
  /**
   * When the aircraft was seen taking off from the origin, in seconds since
   * the epoch, or null when the origin is only as reported.
   */
  departedAt: number | null;
  loading: boolean;
  /** An origin to show: a reported route that fits, or a seen take-off. */
  available: boolean;
  /** The lookup finished without a route that fits. */
  unavailable: boolean;
  /** Providers reported a route, but it does not fit the position. */
  mismatch: boolean;
  /** Where the route came from, or null for a take-off seen alone. */
  source: RouteSource | null;
};

/**
 * Looks up the routes providers report for the flight's callsign, then
 * keeps the leg that best fits the live position. The check reruns on
 * every position update, so the next leg takes over at a stop and a route
 * that stops fitting disappears, without another request.
 *
 * When the aircraft's history shows its take-off, only a leg from there
 * can be shown, and if no provider reports one, the departure airport is
 * shown on its own: it is what the aircraft was seen to do.
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
  const takeoff = useTrailStoreSnapshot((state) =>
    flight && state.history.selectedIcao24 === flight.icao24
      ? state.history.takeoff
      : null,
  );

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
  const departure = position && !position.onGround ? takeoff : null;
  const aircraft = flight ? `${flight.icao24}:${callsign}` : null;
  const current = shown?.aircraft === aircraft ? shown.route : null;
  const route = routes
    ? selectReportedRoute(routes, position, {
        current,
        departedFrom: departure,
      })
    : null;

  // Remember the leg shown, so it holds while it still fits.
  if (aircraft && route && !(current && isSameLeg(route, current))) {
    setShown({ aircraft, route });
  }

  const loading = callsign !== null && routes === null;
  // An aircraft without a callsign has no routes to look up, but its
  // take-off can still be seen.
  const origin =
    route?.origin ??
    (!loading && departure ? takeoffAirport(departure, routes ?? []) : null);

  return {
    origin,
    destination: route?.destination ?? null,
    departedAt: origin && departure ? departure.time : null,
    loading,
    available: origin !== null,
    unavailable: routes !== null && origin === null,
    mismatch: routes !== null && routes.length > 0 && origin === null,
    source: route?.source ?? null,
  };
}

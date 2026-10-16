import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RouteSummary } from "./flight-card";
import type { FlightRouteInfo } from "@/hooks/use-route-info";

const VALID_ROUTE: FlightRouteInfo = {
  origin: {
    iata: "SFO",
    icao: "KSFO",
    name: "San Francisco International Airport",
    municipality: "San Francisco",
    countryIso: "US",
    latitude: 37.6213,
    longitude: -122.379,
  },
  destination: {
    iata: "JFK",
    icao: "KJFK",
    name: "John F. Kennedy International Airport",
    municipality: "New York",
    countryIso: "US",
    latitude: 40.6413,
    longitude: -73.7781,
  },
  loading: false,
  available: true,
  unavailable: false,
  mismatch: false,
  source: "adsbdb",
};

test("RouteSummary labels a valid result as a reported route", () => {
  const html = renderToStaticMarkup(
    createElement(RouteSummary, { routeInfo: VALID_ROUTE }),
  );

  assert.match(html, /Reported route/);
  assert.match(html, /SFO/);
  assert.match(html, /JFK/);
  assert.doesNotMatch(html, /verified/i);
  assert.doesNotMatch(html, />-</);
});

test("RouteSummary keeps its row while loading and when no route is reported", () => {
  const loading = renderToStaticMarkup(
    createElement(RouteSummary, {
      routeInfo: { ...VALID_ROUTE, available: false, loading: true },
    }),
  );
  const missing = renderToStaticMarkup(
    createElement(RouteSummary, {
      routeInfo: { ...VALID_ROUTE, available: false, origin: null, destination: null },
    }),
  );

  const mismatch = renderToStaticMarkup(
    createElement(RouteSummary, {
      routeInfo: { ...VALID_ROUTE, available: false, mismatch: true },
    }),
  );

  assert.match(loading, /Looking up the route/);
  assert.match(missing, /No route reported/);
  assert.match(mismatch, /route doesn’t match this aircraft/);
  assert.doesNotMatch(missing, /SFO|JFK/);
});

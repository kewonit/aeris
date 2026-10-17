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
  departedAt: null,
  loading: false,
  available: true,
  unavailable: false,
  mismatch: false,
  source: "adsbdb",
};

const NOW = Date.UTC(2026, 9, 17, 18, 0);

test("RouteSummary labels a valid result as a reported route", () => {
  const html = renderToStaticMarkup(
    createElement(RouteSummary, { routeInfo: VALID_ROUTE, now: NOW }),
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
      now: NOW,
    }),
  );
  const missing = renderToStaticMarkup(
    createElement(RouteSummary, {
      routeInfo: { ...VALID_ROUTE, available: false, origin: null, destination: null },
      now: NOW,
    }),
  );

  const mismatch = renderToStaticMarkup(
    createElement(RouteSummary, {
      routeInfo: { ...VALID_ROUTE, available: false, mismatch: true },
      now: NOW,
    }),
  );

  assert.match(loading, /Looking up the route/);
  assert.match(missing, /No route reported/);
  assert.match(mismatch, /route doesn’t match this aircraft/);
  assert.doesNotMatch(missing, /SFO|JFK/);
});

test("RouteSummary says when the aircraft was seen taking off", () => {
  const html = renderToStaticMarkup(
    createElement(RouteSummary, {
      routeInfo: { ...VALID_ROUTE, departedAt: NOW / 1_000 - 47 * 60 },
      now: NOW,
    }),
  );

  assert.match(html, />Route</);
  assert.doesNotMatch(html, /Reported route/);
  assert.match(html, /Took off 47 min ago/);
  assert.match(html, /SFO/);
  assert.match(html, /JFK/);
});

test("RouteSummary shows a seen departure when no destination is reported", () => {
  const html = renderToStaticMarkup(
    createElement(RouteSummary, {
      routeInfo: {
        ...VALID_ROUTE,
        destination: null,
        departedAt: NOW / 1_000 - 90 * 60,
        source: null,
      },
      now: NOW,
    }),
  );

  assert.match(html, /SFO/);
  assert.match(html, /Not reported/);
  assert.match(html, /Took off 1 h 30 min ago/);
  assert.doesNotMatch(html, /JFK/);
});

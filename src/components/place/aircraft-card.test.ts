import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RouteBlock } from "./aircraft-card";
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
const CRUISING = { progress: null } as const;

test("RouteBlock shows a reported route without hedging it", () => {
  const html = renderToStaticMarkup(
    createElement(RouteBlock, { routeInfo: VALID_ROUTE, status: CRUISING, now: NOW }),
  );

  assert.doesNotMatch(html, /Reported route/);
  assert.match(html, /SFO/);
  assert.match(html, /JFK/);
  assert.doesNotMatch(html, /verified/i);
  assert.doesNotMatch(html, />-</);
});

test("RouteBlock keeps its row while loading and when no route is reported", () => {
  const loading = renderToStaticMarkup(
    createElement(RouteBlock, {
      routeInfo: { ...VALID_ROUTE, available: false, loading: true },
      status: CRUISING,
      now: NOW,
    }),
  );
  const missing = renderToStaticMarkup(
    createElement(RouteBlock, {
      routeInfo: { ...VALID_ROUTE, available: false, origin: null, destination: null },
      status: CRUISING,
      now: NOW,
    }),
  );

  const mismatch = renderToStaticMarkup(
    createElement(RouteBlock, {
      routeInfo: { ...VALID_ROUTE, available: false, mismatch: true },
      status: CRUISING,
      now: NOW,
    }),
  );

  assert.match(loading, /Looking up the route/);
  assert.match(missing, /No route reported/);
  assert.match(mismatch, /route doesn’t match this aircraft/);
  assert.doesNotMatch(missing, /SFO|JFK/);
});

test("RouteBlock says when the aircraft was seen taking off", () => {
  const html = renderToStaticMarkup(
    createElement(RouteBlock, {
      routeInfo: { ...VALID_ROUTE, departedAt: NOW / 1_000 - 47 * 60 },
      status: CRUISING,
      now: NOW,
    }),
  );

  assert.doesNotMatch(html, /Reported route/);
  assert.match(html, /Took off 47 min ago/);
  assert.match(html, /SFO/);
  assert.match(html, /JFK/);
});

test("RouteBlock shows a seen departure when no destination is reported", () => {
  const html = renderToStaticMarkup(
    createElement(RouteBlock, {
      routeInfo: {
        ...VALID_ROUTE,
        destination: null,
        departedAt: NOW / 1_000 - 90 * 60,
        source: null,
      },
      status: CRUISING,
      now: NOW,
    }),
  );

  assert.match(html, /SFO/);
  assert.match(html, /Not reported/);
  assert.match(html, /Took off 1h 30m ago/);
  assert.doesNotMatch(html, /JFK/);
});

test("RouteBlock shows progress once both ends are known, and no second ETA", () => {
  const html = renderToStaticMarkup(
    createElement(RouteBlock, {
      routeInfo: VALID_ROUTE,
      status: { progress: 0.42 },
      now: NOW,
    }),
  );

  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="42"/);
  assert.doesNotMatch(html, /Lands in/);
});

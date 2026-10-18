import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Airport } from "@/lib/airports";

import { CardHeader } from "./card-header";

const TEST_AIRPORT: Airport = {
  iata: "SFO",
  icao: "KSFO",
  name: "San Francisco International Airport",
  city: "San Francisco",
  country: "US",
  lat: 37.6188056,
  lng: -122.3754167,
  elevation_ft: 13,
};

test("CardHeader omits the flight category when the METAR has none", () => {
  const html = renderToStaticMarkup(
    createElement(CardHeader, {
      airport: TEST_AIRPORT,
      icao: "KSFO",
      metar: {
        rawOb: "KSFO 201656Z 30015KT 10SM FEW008 13/09 A2992",
      },
    }),
  );

  assert.match(html, /SFO/);
  assert.match(html, /KSFO/);
  assert.doesNotMatch(html, /VFR|IFR/);
  assert.doesNotMatch(html, />-</);
});

test("CardHeader shows sheet controls only on mobile", () => {
  const sidebar = renderToStaticMarkup(
    createElement(CardHeader, { airport: TEST_AIRPORT, icao: "KSFO", metar: null }),
  );
  const sheet = renderToStaticMarkup(
    createElement(CardHeader, {
      airport: TEST_AIRPORT,
      icao: "KSFO",
      metar: { rawOb: "KSFO", fltcat: "IFR" },
      sheet: { collapsed: false, onToggleCollapse: () => {}, onClose: () => {} },
    }),
  );

  assert.doesNotMatch(sidebar, /<button/);
  assert.match(sheet, /Close airport details/);
  assert.match(sheet, /IFR/);
});

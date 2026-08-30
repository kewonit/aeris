import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PhotoBanner } from "./photo-banner";

test("PhotoBanner fallback hero omits the decorative profile badge", () => {
  const html = renderToStaticMarkup(
    createElement(PhotoBanner, {
      photo: null,
      loading: false,
      errored: false,
      onError: () => {},
      onClose: () => {},
      airportName: "San Francisco International Airport",
      iata: "SFO",
      icao: "KSFO",
      city: "San Francisco",
      country: "US",
    }),
  );

  assert.match(html, /SFO/);
  assert.match(html, /KSFO/);
  assert.match(html, /San Francisco International Airport/);
  assert.doesNotMatch(html, /Airport profile/i);
  assert.doesNotMatch(html, /bg-foreground\/45/);
  assert.doesNotMatch(html, /Wikipedia/);
});

test("PhotoBanner renders Wikimedia credit when a photo exists", () => {
  const html = renderToStaticMarkup(
    createElement(PhotoBanner, {
      photo: {
        imageUrl: "https://example.com/original.jpg",
        thumbUrl: "https://example.com/thumb.jpg",
        width: 500,
        height: 300,
        pageUrl: "https://example.com/wiki/SFO",
        pageTitle: "San Francisco International Airport",
        description: "Airport in California",
      },
      loading: false,
      errored: false,
      onError: () => {},
      onClose: () => {},
      airportName: "San Francisco International Airport",
      iata: "SFO",
      icao: "KSFO",
      city: "San Francisco",
      country: "US",
    }),
  );

  assert.match(html, /https:\/\/example.com\/thumb.jpg/);
  assert.match(html, /Wikipedia/);
});

test("PhotoBanner uses the compact sidebar hero without a pulse", () => {
  const html = renderToStaticMarkup(
    createElement(PhotoBanner, {
      photo: null,
      loading: true,
      errored: false,
      onError: () => {},
      airportName: "San Francisco International Airport",
      iata: "SFO",
      icao: "KSFO",
      city: "San Francisco",
      country: "US",
      variant: "sidebar",
    }),
  );

  assert.match(html, /aeris-airport-hero/);
  assert.match(html, /h-48/);
  assert.doesNotMatch(html, /animate-pulse/);
});

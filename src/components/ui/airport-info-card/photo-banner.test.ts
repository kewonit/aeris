import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PhotoBanner } from "./photo-banner";

const BASE = {
  errored: false,
  onError: () => {},
  airportName: "San Francisco International Airport",
};

const PHOTO = {
  imageUrl: "https://example.com/original.jpg",
  thumbUrl: "https://example.com/thumb.jpg",
  width: 500,
  height: 300,
  pageUrl: "https://example.com/wiki/SFO",
  pageTitle: "San Francisco International Airport",
  description: "Airport in California",
};

test("PhotoBanner renders the photo and holds the credit until it loads", () => {
  const html = renderToStaticMarkup(
    createElement(PhotoBanner, { ...BASE, photo: PHOTO, loading: false }),
  );

  assert.match(html, /https:\/\/example.com\/thumb.jpg/);
  assert.match(html, /alt="San Francisco International Airport"/);
  assert.doesNotMatch(html, /Wikipedia/);
});

test("PhotoBanner keeps its space while the photo lookup runs", () => {
  const html = renderToStaticMarkup(
    createElement(PhotoBanner, { ...BASE, photo: null, loading: true }),
  );

  assert.notEqual(html, "");
  assert.doesNotMatch(html, /<img/);
});

test("PhotoBanner keeps its frame without a usable photo", () => {
  const missing = renderToStaticMarkup(
    createElement(PhotoBanner, { ...BASE, photo: null, loading: false }),
  );
  const failed = renderToStaticMarkup(
    createElement(PhotoBanner, {
      ...BASE,
      photo: PHOTO,
      loading: false,
      errored: true,
    }),
  );

  for (const html of [missing, failed]) {
    assert.match(html, /No photo of this airport/);
    assert.doesNotMatch(html, /<img/);
  }
});

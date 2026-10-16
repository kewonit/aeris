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

test("PhotoBanner shows the photo with its Wikipedia credit", () => {
  const html = renderToStaticMarkup(
    createElement(PhotoBanner, { ...BASE, photo: PHOTO, loading: false }),
  );

  assert.match(html, /https:\/\/example.com\/thumb.jpg/);
  assert.match(html, /alt="San Francisco International Airport"/);
  assert.match(html, /href="https:\/\/example.com\/wiki\/SFO"/);
});

test("PhotoBanner keeps its space while the photo lookup runs", () => {
  const html = renderToStaticMarkup(
    createElement(PhotoBanner, { ...BASE, photo: null, loading: true }),
  );

  assert.notEqual(html, "");
  assert.doesNotMatch(html, /<img/);
});

test("PhotoBanner collapses without a usable photo", () => {
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

  assert.equal(missing, "");
  assert.equal(failed, "");
});

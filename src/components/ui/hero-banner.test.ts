import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeroBanner } from "./hero-banner";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";

const PHOTO: NormalizedPhoto = {
  id: "photo-1",
  url: "https://example.com/aircraft.jpg",
  thumbnail: "https://example.com/aircraft-thumb.jpg",
  photographer: "Test Photographer",
  location: null,
  dateTaken: null,
  link: "https://example.com/photo-1",
};

test("HeroBanner shows the photo with its alt text", () => {
  const html = renderToStaticMarkup(
    createElement(HeroBanner, {
      photo: PHOTO,
      loading: false,
      alt: "JAL60 aircraft",
    }),
  );

  assert.match(html, /alt="JAL60 aircraft"/);
  assert.match(html, /https:\/\/example\.com\/aircraft\.jpg/);
});

test("HeroBanner keeps its space while the photo lookup runs", () => {
  const html = renderToStaticMarkup(
    createElement(HeroBanner, {
      photo: null,
      loading: true,
      alt: "Aircraft",
    }),
  );

  assert.notEqual(html, "");
  assert.doesNotMatch(html, /<img/);
});

test("HeroBanner keeps its frame when the lookup finds no photo", () => {
  const html = renderToStaticMarkup(
    createElement(HeroBanner, {
      photo: null,
      loading: false,
      alt: "Aircraft",
    }),
  );

  assert.match(html, /No photo of this aircraft/);
  assert.doesNotMatch(html, /<img/);
});

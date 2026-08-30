import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeroBanner, shouldRenderHeroBanner } from "./hero-banner";
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

test("HeroBanner renders the old hero height for a valid photo", () => {
  const html = renderToStaticMarkup(
    createElement(HeroBanner, {
      photo: PHOTO,
      loading: false,
      alt: "JAL60 aircraft",
    }),
  );

  assert.match(html, /h-52/);
  assert.match(html, /sm:h-56/);
  assert.match(html, /JAL60 aircraft/);
  assert.match(html, /https:\/\/example\.com\/aircraft\.jpg/);
});

test("HeroBanner renders a full-height loading skeleton", () => {
  const html = renderToStaticMarkup(
    createElement(HeroBanner, {
      photo: null,
      loading: true,
      alt: "Aircraft",
    }),
  );

  assert.match(html, /h-52/);
  assert.match(html, /animate-pulse/);
  assert.doesNotMatch(html, /<img/);
});

test("HeroBanner uses the compact material state in a sidebar", () => {
  const html = renderToStaticMarkup(
    createElement(HeroBanner, {
      photo: null,
      loading: true,
      alt: "Aircraft",
      variant: "sidebar",
    }),
  );

  assert.match(html, /aeris-sidebar-hero/);
  assert.match(html, /h-44/);
  assert.match(html, /Loading aircraft photo/);
  assert.doesNotMatch(html, /animate-pulse/);
});

test("HeroBanner collapses after an empty photo result", () => {
  const html = renderToStaticMarkup(
    createElement(HeroBanner, {
      photo: null,
      loading: false,
      alt: "Aircraft",
    }),
  );

  assert.equal(html, "");
});

test("HeroBanner collapses after all photo candidates fail", () => {
  assert.equal(shouldRenderHeroBanner(PHOTO, false, true), false);
  assert.equal(shouldRenderHeroBanner(PHOTO, false, false), true);
});

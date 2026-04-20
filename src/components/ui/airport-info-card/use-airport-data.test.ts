import assert from "node:assert/strict";
import test from "node:test";

import type { AirportPhoto, TafData } from "./types";
import { requestAirportPhoto, requestTaf } from "./use-airport-data";

test("requestTaf treats successful empty responses as cacheable", async () => {
  const result = await requestTaf(
    "KSFO",
    new AbortController().signal,
    async () =>
      ({
        ok: true,
        json: async () => [],
      }) as Response,
  );

  assert.deepEqual(result, { taf: null, cacheable: true });
});

test("requestTaf avoids caching upstream or server errors", async () => {
  const result = await requestTaf(
    "KSFO",
    new AbortController().signal,
    async () => ({ ok: false }) as Response,
  );

  assert.deepEqual(result, { taf: null, cacheable: false });
});

test("requestTaf returns the first TAF from successful responses", async () => {
  const taf: TafData = {
    rawTAF: "KSFO 201720Z 2018/2124 30014KT P6SM FEW020",
  };

  const result = await requestTaf(
    "KSFO",
    new AbortController().signal,
    async () =>
      ({
        ok: true,
        json: async () => [taf],
      }) as Response,
  );

  assert.deepEqual(result, { taf, cacheable: true });
});

test("requestAirportPhoto forwards optional airport metadata to the route", async () => {
  let requestedUrl = "";

  await requestAirportPhoto(
    {
      name: "San Francisco International Airport",
      iata: "SFO",
      icao: "KSFO",
      city: "San Francisco",
    },
    new AbortController().signal,
    async (input) => {
      requestedUrl = String(input);
      return {
        ok: true,
        json: async () => ({ photo: null }),
      } as Response;
    },
  );

  assert.match(
    requestedUrl,
    /name=San(?:\+|%20)Francisco(?:\+|%20)International(?:\+|%20)Airport/,
  );
  assert.match(requestedUrl, /iata=SFO/);
  assert.match(requestedUrl, /icao=KSFO/);
  assert.match(requestedUrl, /city=San(?:\+|%20)Francisco/);
});

test("requestAirportPhoto treats successful empty responses as cacheable", async () => {
  const result = await requestAirportPhoto(
    "Haneda Airport",
    new AbortController().signal,
    async () =>
      ({
        ok: true,
        json: async () => ({ photo: null }),
      }) as Response,
  );

  assert.deepEqual(result, { photo: null, cacheable: true });
});

test("requestAirportPhoto avoids caching upstream or server errors", async () => {
  const result = await requestAirportPhoto(
    "Haneda Airport",
    new AbortController().signal,
    async () => ({ ok: false }) as Response,
  );

  assert.deepEqual(result, { photo: null, cacheable: false });
});

test("requestAirportPhoto returns photos from successful responses", async () => {
  const photo: AirportPhoto = {
    imageUrl: "https://example.com/photo.jpg",
    thumbUrl: "https://example.com/thumb.jpg",
    width: 500,
    height: 300,
    pageUrl: "https://example.com/wiki/Haneda",
    pageTitle: "Haneda Airport",
    description: "Tokyo airport",
  };

  const result = await requestAirportPhoto(
    "Haneda Airport",
    new AbortController().signal,
    async () =>
      ({
        ok: true,
        json: async () => ({ photo }),
      }) as Response,
  );

  assert.deepEqual(result, { photo, cacheable: true });
});

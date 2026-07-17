import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAircraftPhotosFlags,
  mergeAircraftPhotoResults,
  type AircraftPhotoFetchResult,
} from "@/hooks/use-aircraft-photos";

const fallbackPhoto = {
  id: "fallback",
  url: "https://example.com/fallback.jpg",
  thumbnail: "https://example.com/fallback-thumb.jpg",
  photographer: null,
  location: null,
  dateTaken: null,
  link: null,
};

const preferredPhoto = {
  id: "preferred",
  url: "https://example.com/preferred.jpg",
  thumbnail: "https://example.com/preferred-thumb.jpg",
  photographer: null,
  location: null,
  dateTaken: null,
  link: null,
};

test("deriveAircraftPhotosFlags reports an error for failed negative cache entries", () => {
  assert.deepEqual(
    deriveAircraftPhotosFlags({
      hasIcao24: true,
      fallbackResult: { failed: true },
      cacheKey: "abc123",
      errorKey: "abc123",
      resolvedKey: null,
    }),
    {
      loading: false,
      error: true,
    },
  );
});

test("deriveAircraftPhotosFlags keeps successful empty cache entries non-erroring", () => {
  assert.deepEqual(
    deriveAircraftPhotosFlags({
      hasIcao24: true,
      fallbackResult: { failed: false },
      cacheKey: "abc123",
      errorKey: null,
      resolvedKey: "abc123",
    }),
    {
      loading: false,
      error: false,
    },
  );
});

test("deriveAircraftPhotosFlags stays loading while a request is still pending", () => {
  assert.deepEqual(
    deriveAircraftPhotosFlags({
      hasIcao24: true,
      fallbackResult: null,
      cacheKey: "abc123",
      errorKey: null,
      resolvedKey: null,
    }),
    {
      loading: true,
      error: false,
    },
  );
});

test("mergeAircraftPhotoResults keeps fallback photos when enrichment has none", () => {
  const fallback: AircraftPhotoFetchResult = {
    aircraft: {
      registration: "N12345",
      manufacturer: "Boeing",
      type: "737",
      typeCode: "B738",
      owner: "Fallback Air",
      airline: "Fallback Air",
    },
    photos: [fallbackPhoto],
  };

  assert.deepEqual(
    mergeAircraftPhotoResults({ aircraft: null, photos: [] }, fallback),
    fallback,
  );
});

test("mergeAircraftPhotoResults prefers enriched photos and keeps fallback aircraft", () => {
  const fallback: AircraftPhotoFetchResult = {
    aircraft: {
      registration: "N12345",
      manufacturer: "Boeing",
      type: "737",
      typeCode: "B738",
      owner: "Fallback Air",
      airline: "Fallback Air",
    },
    photos: [fallbackPhoto],
  };

  assert.deepEqual(
    mergeAircraftPhotoResults(
      { aircraft: null, photos: [preferredPhoto] },
      fallback,
    ),
    {
      aircraft: fallback.aircraft,
      photos: [preferredPhoto],
    },
  );
});

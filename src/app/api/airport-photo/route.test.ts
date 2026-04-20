import assert from "node:assert/strict";
import test from "node:test";

import { __internals } from "./route";

type SearchPage = {
  id: number;
  key: string;
  title: string;
  description?: string | null;
  thumbnail?: {
    url: string;
    width: number;
    height: number;
  } | null;
};

const THUMB = {
  url: "//upload.wikimedia.org/example/60px-airport.jpg",
  width: 60,
  height: 40,
};

test("buildSearchQueries expands airport lookups with codes and city context", () => {
  const queries = __internals.buildSearchQueries({
    name: "San Francisco International Airport",
    iata: "SFO",
    icao: "KSFO",
    city: "San Francisco",
  });

  assert.deepEqual(queries, [
    "San Francisco International Airport",
    "San Francisco International Airport airport",
    "San Francisco International Airport San Francisco",
    "SFO airport",
    "KSFO airport",
    "San Francisco airport",
  ]);
});

test("selectBestSearchPage prefers the actual airport over transit lookalikes", () => {
  const pages: SearchPage[] = [
    {
      id: 1,
      key: "San_Francisco_International_Airport_station",
      title: "San Francisco International Airport station",
      description: "BART station serving the airport",
      thumbnail: THUMB,
    },
    {
      id: 2,
      key: "San_Francisco_International_Airport",
      title: "San Francisco International Airport",
      description: "International airport in California, United States",
      thumbnail: THUMB,
    },
  ];

  const page = __internals.selectBestSearchPage(pages, {
    name: "San Francisco International Airport",
    iata: "SFO",
    icao: "KSFO",
    city: "San Francisco",
  });

  assert.equal(page?.key, "San_Francisco_International_Airport");
});

test("selectBestSearchPage ignores strong textual matches when no thumbnail exists", () => {
  const pages: SearchPage[] = [
    {
      id: 1,
      key: "San_Francisco_International_Airport",
      title: "San Francisco International Airport",
      description: "International airport in California, United States",
      thumbnail: null,
    },
  ];

  const page = __internals.selectBestSearchPage(pages, {
    name: "San Francisco International Airport",
    iata: "SFO",
    icao: "KSFO",
    city: "San Francisco",
  });

  assert.equal(page, null);
});

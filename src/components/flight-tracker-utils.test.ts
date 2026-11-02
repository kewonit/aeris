import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CITY,
  parseSelectionLink,
  resolveInitialCity,
  syncCityToUrl,
  writeSelectionLink,
} from "./flight-tracker-utils";

function setWindowLocation(pathname: string, search = "") {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname,
        search,
      },
    },
  });
}

test("resolveInitialCity re-parses location changes and still supports legacy aliases", () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );

  try {
    setWindowLocation("/city/nyc");
    const aliasCity = resolveInitialCity();
    assert.equal(aliasCity.id, "nyc");
    assert.equal(aliasCity.iata, "JFK");

    setWindowLocation("/");
    const defaultCity = resolveInitialCity();
    assert.equal(defaultCity.id, DEFAULT_CITY.id);

    setWindowLocation("/", "?city=bom");
    const legacyQueryCity = resolveInitialCity();
    assert.equal(legacyQueryCity.id, "bom");
    assert.equal(legacyQueryCity.iata, "BOM");
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("syncCityToUrl uses the canonical city route for the default city", () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );

  let replacedUrl = "";

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "https://aeris.edbn.me/city/jfk?fpv=abc123",
        },
        history: {
          replaceState: (_state: unknown, _title: string, url: string) => {
            replacedUrl = url;
          },
        },
      },
    });

    syncCityToUrl(DEFAULT_CITY);

    assert.equal(replacedUrl, "/city/sfo");
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("a link opens first person over follow over a plain selection", () => {
  assert.deepEqual(parseSelectionLink("?fpv=ABC123&follow=def456"), {
    mode: "fpv",
    icao24: "abc123",
  });
  assert.deepEqual(parseSelectionLink("?follow=def456&sel=abc123"), {
    mode: "follow",
    icao24: "def456",
  });
  assert.deepEqual(parseSelectionLink("?sel=abc123"), {
    mode: "select",
    icao24: "abc123",
  });
  assert.deepEqual(parseSelectionLink("?airport=bom"), {
    mode: "airport",
    iata: "BOM",
  });
});

test("a link ignores values that are not aircraft or airport codes", () => {
  assert.equal(parseSelectionLink("?sel=nothex"), null);
  assert.equal(parseSelectionLink("?follow=abc12"), null);
  assert.equal(parseSelectionLink("?airport=VABB"), null);
  assert.equal(parseSelectionLink(""), null);
});

test("the selection writes exactly one link parameter", () => {
  const params = new URLSearchParams("fpv=abc123&sel=abc123&utm_source=x");
  writeSelectionLink(params, {
    selection: { kind: "aircraft", icao24: "abc123" },
    follow: "abc123",
    fpv: null,
  });
  assert.equal(params.toString(), "utm_source=x&follow=abc123");

  writeSelectionLink(params, {
    selection: { kind: "airport", iata: "BOM" },
    follow: null,
    fpv: null,
  });
  assert.equal(params.toString(), "utm_source=x&airport=BOM");

  writeSelectionLink(params, {
    selection: { kind: "none" },
    follow: null,
    fpv: null,
  });
  assert.equal(params.toString(), "utm_source=x");
});

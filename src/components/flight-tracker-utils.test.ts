import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CITY,
  resolveInitialCity,
  syncCityToUrl,
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

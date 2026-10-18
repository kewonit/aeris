import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeCityRequest } from "./city-routing";

test("canonicalizeCityRequest normalizes aliases, case, and legacy city params", () => {
  assert.equal(canonicalizeCityRequest("nyc"), "/city/jfk");
  assert.equal(canonicalizeCityRequest("BOM"), "/city/bom");
  assert.equal(
    canonicalizeCityRequest("bom", "city=bom&fpv=abc123"),
    "/city/bom?fpv=abc123",
  );
  assert.equal(canonicalizeCityRequest("bom", "fpv=abc123"), null);
  assert.equal(canonicalizeCityRequest("zzz"), null);
});

test("canonicalizeCityRequest preserves repeated query values from route params", () => {
  assert.equal(
    canonicalizeCityRequest("BOM", {
      city: "bom",
      fpv: "abc123",
      layer: ["weather", "airspace"],
    }),
    "/city/bom?fpv=abc123&layer=weather&layer=airspace",
  );
});

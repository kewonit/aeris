import assert from "node:assert/strict";
import test from "node:test";

test("canonicalizeCityRequest normalizes aliases, case, and legacy city params", async () => {
  const moduleExports = (await import("./city-routing").catch(
    () => ({}) as Record<string, unknown>,
  )) as {
    canonicalizeCityRequest?: (
      code: string,
      searchParams?: string | URLSearchParams,
    ) => string | null;
  };

  assert.equal(typeof moduleExports.canonicalizeCityRequest, "function");

  const canonicalizeCityRequest = moduleExports.canonicalizeCityRequest!;

  assert.equal(canonicalizeCityRequest("nyc"), "/city/jfk");
  assert.equal(canonicalizeCityRequest("BOM"), "/city/bom");
  assert.equal(
    canonicalizeCityRequest("bom", "city=bom&fpv=abc123"),
    "/city/bom?fpv=abc123",
  );
  assert.equal(canonicalizeCityRequest("bom", "fpv=abc123"), null);
  assert.equal(canonicalizeCityRequest("zzz"), null);
});

test("canonicalizeCityRequest preserves repeated query values from route params", async () => {
  const { canonicalizeCityRequest } = await import("./city-routing");

  assert.equal(
    canonicalizeCityRequest("BOM", {
      city: "bom",
      fpv: "abc123",
      layer: ["weather", "airspace"],
    }),
    "/city/bom?fpv=abc123&layer=weather&layer=airspace",
  );
});

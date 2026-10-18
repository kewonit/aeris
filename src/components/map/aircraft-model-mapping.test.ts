import assert from "node:assert/strict";
import test from "node:test";

import { typeCodeToModelKey } from "./aircraft-model-mapping";

test("light aircraft type codes get the light aircraft model", () => {
  for (const code of [
    "C172",
    "C310",
    "C72R",
    "C82T",
    "T206",
    "P210",
    "PA46",
    "P28A",
    "P32R",
    "P46T",
    "S22T",
    "M20P",
    "RV14",
    "GLAS",
    "CH7A",
  ]) {
    assert.equal(typeCodeToModelKey(code), "light-prop", code);
  }
});

test("Citation letter variants are business jets", () => {
  assert.equal(typeCodeToModelKey("C56X"), "bizjet");
  assert.equal(typeCodeToModelKey("C68A"), "bizjet");
  assert.equal(typeCodeToModelKey("C700"), "bizjet");
});

test("a King Air is a turboprop, not a Bell helicopter", () => {
  assert.equal(typeCodeToModelKey("B350"), "turboprop");
  assert.equal(typeCodeToModelKey("BE20"), "turboprop");
  assert.equal(typeCodeToModelKey("B407"), "helicopter");
  assert.equal(typeCodeToModelKey("B06"), "helicopter");
  assert.equal(typeCodeToModelKey("H47"), "helicopter");
});

test("airliners and excluded types keep their models", () => {
  assert.equal(typeCodeToModelKey("A320"), "narrowbody");
  assert.equal(typeCodeToModelKey("C919"), "narrowbody");
  assert.equal(typeCodeToModelKey("B738"), "b737");
  assert.equal(typeCodeToModelKey("B190"), "turboprop");
  assert.equal(typeCodeToModelKey("B463"), "regional-jet");
  assert.equal(typeCodeToModelKey("C130"), null);
});

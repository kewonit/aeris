import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_KEY_WINGSPAN,
  resolveModelFileKey,
  typeCodeToModelKey,
} from "./aircraft-model-mapping";

test("light aircraft type codes get the light aircraft model", () => {
  for (const code of [
    "C172",
    "C310",
    "C72R",
    "C82T",
    "T206",
    "P210",
    "PA46",
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

test("Citations get the Citation model, other business jets the generic one", () => {
  assert.equal(typeCodeToModelKey("C56X"), "citation");
  assert.equal(typeCodeToModelKey("C68A"), "citation");
  assert.equal(typeCodeToModelKey("C700"), "citation");
  assert.equal(typeCodeToModelKey("GLF6"), "bizjet");
  assert.equal(typeCodeToModelKey("LJ45"), "bizjet");
});

test("a King Air is a turboprop, not a Bell helicopter", () => {
  assert.equal(typeCodeToModelKey("B350"), "turboprop");
  assert.equal(typeCodeToModelKey("BE20"), "turboprop");
  assert.equal(typeCodeToModelKey("B407"), "helicopter");
  assert.equal(typeCodeToModelKey("B06"), "helicopter");
  assert.equal(typeCodeToModelKey("H47"), "helicopter");
});

test("airliners with a model of their own get it", () => {
  assert.equal(typeCodeToModelKey("A320"), "a320");
  assert.equal(typeCodeToModelKey("a21n"), "a321");
  assert.equal(typeCodeToModelKey("B738"), "b738");
  assert.equal(typeCodeToModelKey("B38M"), "b738");
  assert.equal(typeCodeToModelKey("B77W"), "b773");
  assert.equal(typeCodeToModelKey("B78X"), "b789");
  assert.equal(typeCodeToModelKey("A35K"), "a359");
  assert.equal(typeCodeToModelKey("A388"), "a380");
  assert.equal(typeCodeToModelKey("E75L"), "e170");
  assert.equal(typeCodeToModelKey("BCS3"), "cs300");
  assert.equal(typeCodeToModelKey("DH8D"), "q400");
  assert.equal(typeCodeToModelKey("AT76"), "atr72");
  assert.equal(typeCodeToModelKey("B463"), "bae146");
  assert.equal(typeCodeToModelKey("P28A"), "pa28");
});

test("types without a model of their own keep the generic ones", () => {
  assert.equal(typeCodeToModelKey("C919"), "narrowbody");
  assert.equal(typeCodeToModelKey("B712"), "narrowbody");
  assert.equal(typeCodeToModelKey("A306"), "widebody-2eng");
  assert.equal(typeCodeToModelKey("CRJ2"), "regional-jet");
  assert.equal(typeCodeToModelKey("DH8C"), "turboprop");
  assert.equal(typeCodeToModelKey("B190"), "turboprop");
  assert.equal(typeCodeToModelKey("C130"), null);
});

test("an ATR 72 draws the ATR 42's model at its own wingspan", () => {
  assert.equal(resolveModelFileKey("atr72"), "atr42");
  assert.ok(MODEL_KEY_WINGSPAN.atr72 > MODEL_KEY_WINGSPAN.atr42);
});

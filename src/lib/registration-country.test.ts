import assert from "node:assert/strict";
import test from "node:test";

import { countryNameToIso } from "./country-codes";
import { countryFlagEmoji, registrationCountry } from "./registration-country";

function code(registration: string): string | null {
  return registrationCountry(registration)?.code ?? null;
}

test("separates the registries that share the B- mark", () => {
  assert.equal(code("B-1655"), "CN");
  assert.equal(code("B-30AE"), "CN");
  assert.equal(code("B-18901"), "TW");
  assert.equal(code("B-LRT"), "HK");
  assert.equal(code("B-KPF"), "HK");
  assert.equal(code("B-HNR"), "HK");
  assert.equal(code("B-MAX"), "MO");
});

test("only treats N followed by a digit as a US registration", () => {
  assert.equal(code("N100"), "US");
  assert.equal(code("N123AB"), "US");
  assert.equal(code("N-195"), null);
  assert.equal(code("NOREG"), null);
});

test("separates British overseas territories under VP- and VQ-", () => {
  assert.equal(code("VP-CAA"), "KY");
  assert.equal(code("VP-BJA"), "BM");
  assert.equal(code("VQ-BOS"), "BM");
  assert.equal(code("VP-LVA"), "VG");
  assert.equal(code("VQ-TAB"), "TC");
});

test("matches the longest nationality mark first", () => {
  assert.equal(code("C-GABC"), "CA");
  assert.equal(code("CS-TJE"), "PT");
  assert.equal(code("CC-BAA"), "CL");
  assert.equal(code("A9C-AA"), "BH");
  assert.equal(code("A40-SA"), "OM");
  assert.equal(code("9XR-WP"), "RW");
  assert.equal(code("ZS-SNA"), "ZA");
  assert.equal(code("Z-WPA"), "ZW");
});

test("accepts marks without a hyphen where the registry uses none", () => {
  assert.equal(code("JA873J"), "JP");
  assert.equal(code("HL7611"), "KR");
  assert.equal(code("HI1050"), "DO");
  assert.equal(code("UK67001"), "UZ");
});

test("returns null for empty, unknown, or bare marks", () => {
  assert.equal(registrationCountry(null), null);
  assert.equal(registrationCountry("  "), null);
  assert.equal(registrationCountry("QQ-ABC"), null);
  assert.equal(registrationCountry("G-"), null);
});

test("names resolve back to the same code for flag lookup", () => {
  for (const registration of [
    "B-18901",
    "B-LRT",
    "B-MAX",
    "VP-CAA",
    "VQ-TAB",
    "A6-EDA",
    "9Q-CKA",
    "TU-TSN",
    "J8-VBK",
  ]) {
    const country = registrationCountry(registration);
    assert.ok(country, registration);
    assert.equal(countryNameToIso(country.name), country.code, registration);
  }
});

test("builds regional indicator flags", () => {
  assert.equal(countryFlagEmoji("TW"), "🇹🇼");
  assert.equal(countryFlagEmoji("us"), null);
  assert.equal(countryFlagEmoji(null), null);
});

import assert from "node:assert/strict";
import test from "node:test";

test("expandFlightQuery: IATA → ICAO translation", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const ix = expandFlightQuery("IX2680");
  assert.ok(ix.includes("IX2680"), "should include original IATA query");
  assert.ok(ix.includes("AXB2680"), "should include translated ICAO query");
  assert.equal(ix.length, 2);
});

test("expandFlightQuery: ICAO → IATA translation", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const axb = expandFlightQuery("AXB2680");
  assert.ok(axb.includes("AXB2680"), "should include original ICAO query");
  assert.ok(axb.includes("IX2680"), "should include translated IATA query");
  assert.equal(axb.length, 2);
});

test("expandFlightQuery: American Airlines UA → UAL", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const ua = expandFlightQuery("UA123");
  assert.ok(ua.includes("UA123"));
  assert.ok(ua.includes("UAL123"));
});

test("expandFlightQuery: pure flight number without airline code", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const num = expandFlightQuery("2680");
  assert.deepEqual(num, ["2680"]);
});

test("expandFlightQuery: whitespace handling", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const spaced = expandFlightQuery("  IX 2680  ");
  assert.ok(spaced.includes("IX2680"));
  assert.ok(spaced.includes("AXB2680"));
});

test("expandFlightQuery: unknown airline code returns original only", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const unknown = expandFlightQuery("ZZ999");
  assert.deepEqual(unknown, ["ZZ999"]);
});

test("expandFlightQuery: short query without digits returns raw", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const short = expandFlightQuery("IX");
  assert.deepEqual(short, ["IX"]);
});

test("expandFlightQuery: 6-char hex-like callsign", async () => {
  const { expandFlightQuery } = await import("./airlines");
  const aa = expandFlightQuery("AA1234");
  assert.ok(aa.includes("AA1234"));
  assert.ok(aa.includes("AAL1234"));
});

test("flightQueryMatches: direct callsign match", async () => {
  const { flightQueryMatches } = await import("./airlines");
  assert.ok(flightQueryMatches("AXB2680", "AXB2680"));
});

test("flightQueryMatches: IATA query matches ICAO callsign", async () => {
  const { flightQueryMatches } = await import("./airlines");
  assert.ok(flightQueryMatches("IX2680", "AXB2680"));
});

test("flightQueryMatches: ICAO query matches IATA-like callsign", async () => {
  const { flightQueryMatches } = await import("./airlines");
  assert.ok(flightQueryMatches("AXB2680", "IX2680"));
});

test("flightQueryMatches: no match for unrelated flight", async () => {
  const { flightQueryMatches } = await import("./airlines");
  assert.ok(!flightQueryMatches("IX2680", "UAL123"));
});

test("flightQueryMatches: handles null callsign", async () => {
  const { flightQueryMatches } = await import("./airlines");
  assert.ok(!flightQueryMatches("IX2680", null));
});

test("flightQueryMatches: partial match", async () => {
  const { flightQueryMatches } = await import("./airlines");
  assert.ok(flightQueryMatches("2680", "AXB2680"));
});

test("flightQueryMatches: British Airways BA → BAW", async () => {
  const { flightQueryMatches } = await import("./airlines");
  assert.ok(flightQueryMatches("BA123", "BAW123"));
  assert.ok(flightQueryMatches("BAW123", "BA123"));
});

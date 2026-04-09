import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { FlightState } from "@/lib/opensky";
import { trailStore } from "@/lib/trails/store/trail-store";

import { useTrailHistory } from "./use-trail-history";

const TEST_FLIGHT: FlightState = {
  icao24: "abc123",
  callsign: "TEST123",
  originCountry: "Testland",
  longitude: 8.55,
  latitude: 50.04,
  baroAltitude: 11_000,
  onGround: false,
  velocity: 220,
  trueTrack: 270,
  verticalRate: null,
  geoAltitude: 11_100,
  squawk: null,
  spiFlag: false,
  positionSource: 0,
  category: null,
};

function HookHarness(props: { flights?: FlightState[] }) {
  useTrailHistory(props.flights);
  return createElement("div");
}

test("useTrailHistory does not ingest flights during render", () => {
  const originalIngestLiveFlights = trailStore.ingestLiveFlights;
  const ingested: FlightState[][] = [];

  trailStore.ingestLiveFlights = ((flights: FlightState[]) => {
    ingested.push(flights);
  }) as typeof trailStore.ingestLiveFlights;

  try {
    renderToStaticMarkup(
      createElement(HookHarness, { flights: [TEST_FLIGHT] }),
    );

    assert.equal(ingested.length, 0);
  } finally {
    trailStore.ingestLiveFlights = originalIngestLiveFlights;
  }
});

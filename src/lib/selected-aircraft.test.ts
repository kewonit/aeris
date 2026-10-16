import assert from "node:assert/strict";
import test from "node:test";

import type { AircraftRegistryRecord } from "./aircraft-registry";
import type { FlightState } from "./opensky-types";
import {
  clearSelectedAircraftCacheForTests,
  fuseSelectedAircraft,
  loadSelectedAircraftSources,
  selectCoherentFlightState,
} from "./selected-aircraft";

function makeFlight(
  provider: string,
  observationTime: number,
  overrides: Partial<FlightState> = {},
): FlightState {
  return {
    icao24: "abc123",
    callsign: "TST123",
    registrationCountry: null,
    longitude: 77.6,
    latitude: 12.5,
    baroAltitude: 9_144,
    onGround: false,
    velocity: 220,
    trueTrack: 90,
    verticalRate: 0,
    geoAltitude: 9_200,
    squawk: "1200",
    spiFlag: false,
    positionSource: "adsb",
    category: 3,
    provenance: {
      responseTime: observationTime + 500,
      observationTime,
      positionAgeSeconds: 0.5,
      contributingSources: [provider],
      positionProvider: provider,
    },
    ...overrides,
  };
}

test("uses quality as a tie-breaker within two seconds", () => {
  const current = makeFlight("airplanes.live", 10_000, {
    debugData: {
      nic: 9,
      nacP: 10,
      nacV: null,
      sil: null,
      version: 2,
      alert: null,
      messages: null,
      seen: null,
      rssi: null,
    },
  });
  const fresh = makeFlight("adsb.lol", 11_000, {
    longitude: 78,
    debugData: {
      nic: 8,
      nacP: 8,
      nacV: null,
      sil: null,
      version: 2,
      alert: null,
      messages: null,
      seen: null,
      rssi: null,
    },
  });

  assert.equal(selectCoherentFlightState(current, fresh), current);
  assert.equal(
    selectCoherentFlightState(current, makeFlight("adsb.lol", 13_000))
      .provenance.positionProvider,
    "adsb.lol",
  );
});

test("keeps timing and provider with the selected position group", () => {
  const current = makeFlight("airplanes.live", 10_000, {
    provenance: {
      responseTime: 12_000,
      observationTime: 10_000,
      positionAgeSeconds: 2,
      contributingSources: ["airplanes.live"],
      positionProvider: "airplanes.live",
    },
    debugData: {
      nic: 9,
      nacP: 10,
      nacV: null,
      sil: null,
      version: 2,
      alert: null,
      messages: null,
      seen: null,
      rssi: null,
    },
  });
  const fresh = makeFlight("adsb.lol", 11_000, {
    provenance: {
      responseTime: 20_000,
      observationTime: 11_000,
      positionAgeSeconds: 9,
      contributingSources: ["adsb.lol"],
      positionProvider: "adsb.lol",
    },
    debugData: {
      nic: 8,
      nacP: 8,
      nacV: null,
      sil: null,
      version: 2,
      alert: null,
      messages: null,
      seen: null,
      rssi: null,
    },
  });

  const result = fuseSelectedAircraft(current, fresh, null);
  assert.equal(result.provenance.responseTime, 12_000);
  assert.equal(result.provenance.observationTime, 10_000);
  assert.equal(result.provenance.positionAgeSeconds, 2);
  assert.equal(
    result.provenance.positionProvider,
    "airplanes.live",
  );
});

test("adds preferred registry metadata and all contributing sources", () => {
  const current = makeFlight("airplanes.live", 10_000);
  const fresh = makeFlight("adsb.lol", 13_000);
  const registry: AircraftRegistryRecord = {
    icao24: "abc123",
    registration: "N100",
    typeCode: "C172",
    model: "172K",
    manufacturer: "CESSNA",
    registrationCountry: "United States",
    registrationCountryFlag: "🇺🇸",
    databaseFlags: "00",
    sources: ["faa", "mictronics"],
  };

  const result = fuseSelectedAircraft(current, fresh, registry);
  assert.equal(result.registration, "N100");
  assert.equal(result.model, "172K");
  assert.equal(result.manufacturer, "CESSNA");
  assert.equal(result.registrationCountry, "United States");
  assert.deepEqual(result.provenance.contributingSources, [
    "airplanes.live",
    "adsb.lol",
    "faa",
    "mictronics",
  ]);
});

test("live fields follow the feed once the selection lookup is older", () => {
  const fresh = makeFlight("adsb.lol", 10_000, { callsign: "OLD1" });
  const current = makeFlight("airplanes.live", 60_000, { callsign: "NEW2" });

  const result = fuseSelectedAircraft(current, fresh, null);
  assert.equal(result.callsign, "NEW2");
  assert.equal(result.provenance.positionProvider, "airplanes.live");
});

test("caches complete lookups and retries failed ones", async () => {
  clearSelectedAircraftCacheForTests();
  let freshRequests = 0;
  let registryRequests = 0;
  let failFresh = true;
  const loaders = {
    fetchFresh: async () => {
      freshRequests++;
      if (failFresh) throw new Error("temporary failure");
      return null;
    },
    lookupRegistry: async () => {
      registryRequests++;
      return null;
    },
  };

  const failed = await loadSelectedAircraftSources("abc123", undefined, loaders);
  assert.equal(failed.fresh, null);
  failFresh = false;
  const first = await loadSelectedAircraftSources("abc123", undefined, loaders);
  const second = await loadSelectedAircraftSources("abc123", undefined, loaders);
  assert.equal(second, first);
  assert.equal(freshRequests, 2);
  assert.equal(registryRequests, 2);
  clearSelectedAircraftCacheForTests();
});

test("cancels stale selected-aircraft requests", async () => {
  clearSelectedAircraftCacheForTests();
  const controller = new AbortController();
  const waitForAbort = (_value: string, signal?: AbortSignal) =>
    new Promise<null>((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  const request = loadSelectedAircraftSources("abc123", controller.signal, {
    fetchFresh: waitForAbort,
    lookupRegistry: waitForAbort,
  });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  clearSelectedAircraftCacheForTests();
});

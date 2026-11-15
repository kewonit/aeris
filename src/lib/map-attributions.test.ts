import assert from "node:assert/strict";
import test from "node:test";
import { getAttributions, MAP_STYLES } from "./map-styles";

const labels = (...args: Parameters<typeof getAttributions>) =>
  getAttributions(...args).map((entry) => entry.label);

test("CARTO maps credit OpenStreetMap contributors and CARTO, nothing else", () => {
  assert.deepEqual(labels("dark"), ["© OpenStreetMap contributors", "© CARTO"]);
  assert.deepEqual(labels("voyager-labels"), [
    "© OpenStreetMap contributors",
    "© CARTO",
  ]);
});

test("the terrain map adds a link to the terrain sources", () => {
  assert.deepEqual(labels("dark-terrain"), [
    "© OpenStreetMap contributors",
    "© CARTO",
    "Terrain sources",
  ]);
});

test("Esri maps say Powered by Esri and list the service's sources", () => {
  const satellite = labels("satellite");
  assert.equal(satellite[0], "Powered by Esri");
  assert.match(satellite[1], /^Source: Esri, Vantor, Earthstar Geographics/);
  const topo = labels("topo");
  assert.equal(topo[0], "Powered by Esri");
  assert.match(topo[1], /OpenStreetMap contributors/);
});

test("MapLibre is never credited on the map", () => {
  for (const style of MAP_STYLES) {
    assert.ok(!labels(style.id).some((label) => /maplibre/i.test(label)));
  }
});

test("only the provider the aircraft come from is credited", () => {
  assert.deepEqual(labels("dark", { flightSource: "adsbfi" }).slice(2), [
    "adsb.fi",
  ]);
  assert.deepEqual(labels("dark", { flightSource: "adsb" }).slice(2), [
    "adsb.lol (ODbL)",
  ]);
  assert.deepEqual(labels("dark", { flightSource: "airplanes" }).slice(2), [
    "airplanes.live",
  ]);
  assert.deepEqual(labels("dark", { flightSource: "opensky" }).slice(2), [
    "The OpenSky Network",
  ]);
  assert.deepEqual(labels("dark", { flightSource: "none" }).slice(2), []);
  assert.deepEqual(labels("dark", { flightSource: null }).slice(2), []);
});

test("overlays are credited only while they are on", () => {
  assert.deepEqual(
    labels("dark", { showWeatherRadar: true, showAirspace: true }).slice(2),
    ["RainViewer", "OpenAIP"],
  );
  assert.deepEqual(labels("dark", {}).slice(2), []);
});

test("every linked credit links somewhere real", () => {
  for (const entry of getAttributions("dark-terrain", {
    flightSource: "adsb",
    showWeatherRadar: true,
    showAirspace: true,
  })) {
    if (entry.url) assert.match(entry.url, /^https:\/\//);
  }
});

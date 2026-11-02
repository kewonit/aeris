import assert from "node:assert/strict";
import test from "node:test";

import { describeNotableWeather, describeWeatherGroup } from "./metar-words";

test("weather groups read as words", () => {
  assert.equal(describeWeatherGroup("-RA"), "light rain");
  assert.equal(describeWeatherGroup("+TSRA"), "thunderstorms with heavy rain");
  assert.equal(describeWeatherGroup("-SHRA"), "light rain showers");
  assert.equal(describeWeatherGroup("FZFG"), "freezing fog");
  assert.equal(describeWeatherGroup("VCSH"), "showers nearby");
  assert.equal(describeWeatherGroup("BR"), "mist");
  assert.equal(describeWeatherGroup(""), null);
});

test("fair weather says nothing", () => {
  assert.equal(
    describeNotableWeather("SFO", { visib: "10+", clouds: [] }, "aviation"),
    null,
  );
  // Haze with good visibility is not worth a line.
  assert.equal(
    describeNotableWeather(
      "BOM",
      { wxString: "HZ", visib: 4, clouds: [{ cover: "BKN", base: 10_000 }] },
      "aviation",
    ),
    null,
  );
});

test("rain, low visibility, low cloud and gusts are named", () => {
  assert.equal(
    describeNotableWeather(
      "BOM",
      {
        wxString: "+RA BR",
        visib: 1.25,
        clouds: [
          { cover: "FEW", base: 300 },
          { cover: "OVC", base: 800 },
        ],
        wgst: 32,
      },
      "aviation",
    ),
    "BOM: heavy rain, mist, visibility 1.25 SM, cloud at 800 ft, gusts 32 kt",
  );
  assert.equal(
    describeNotableWeather("LHR", { visib: 1.86 }, "metric"),
    "LHR: visibility 3 km",
  );
});

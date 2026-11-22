import assert from "node:assert/strict";
import test from "node:test";

import { legendTicksMeters } from "./altitude-legend-ticks";
import { formatAltitude } from "./unit-formatters";

for (const unitSystem of ["aviation", "imperial", "metric"] as const) {
  test(`the altitude key reads in round numbers (${unitSystem})`, () => {
    const ticks = legendTicksMeters(unitSystem);
    for (const tick of ticks) {
      const label = formatAltitude(tick, unitSystem);
      const value = Number(label.replace(/[^\d]/g, ""));
      assert.match(label, unitSystem === "metric" ? / m$/ : / ft$/);
      assert.equal(value % 50, 0, label);
    }
  });

  test(`the altitude key runs from high to the ground (${unitSystem})`, () => {
    const ticks = legendTicksMeters(unitSystem);
    assert.equal(ticks.at(-1), 0);
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] < ticks[i - 1]);
  });
}

test("the key's labels are the heights it is drawn for", () => {
  assert.deepEqual(
    legendTicksMeters("aviation").map((m) => formatAltitude(m, "aviation")),
    ["40,000 ft", "20,000 ft", "10,000 ft", "5,000 ft", "2,000 ft", "500 ft", "0 ft"],
  );
  assert.deepEqual(
    legendTicksMeters("metric").map((m) => formatAltitude(m, "metric")),
    ["12,000 m", "6,000 m", "3,000 m", "1,500 m", "600 m", "150 m", "0 m"],
  );
});

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
  // Digits only: the thousands separator follows the machine's locale.
  const digits = (unit: "aviation" | "metric") =>
    legendTicksMeters(unit).map((m) =>
      Number(formatAltitude(m, unit).replace(/[^\d]/g, "")),
    );
  assert.deepEqual(digits("aviation"), [40_000, 20_000, 10_000, 5_000, 2_000, 500, 0]);
  assert.deepEqual(digits("metric"), [12_000, 6_000, 3_000, 1_500, 600, 150, 0]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  altitudeRamp,
  altitudeToColor,
  setAltitudeTheme,
} from "./flight-utils";

type RGB = readonly [number, number, number];

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function oklabLightness(rgb: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const PAGE_LIGHT: RGB = [0xfa, 0xfa, 0xf9];
const PAGE_DARK: RGB = [0x12, 0x12, 0x14];

test("on a dark map, higher is never dimmer", () => {
  const ramp = altitudeRamp("dark");
  for (let i = 1; i < ramp.length; i++) {
    assert.ok(
      oklabLightness(ramp[i]) >= oklabLightness(ramp[i - 1]) - 0.01,
      `step ${i} gets darker`,
    );
  }
});

test("every height stands out from the page it is drawn on", () => {
  for (const color of altitudeRamp("light")) {
    assert.ok(contrast(color, PAGE_LIGHT) >= 3, `${color} on the light page`);
  }
  for (const color of altitudeRamp("dark")) {
    assert.ok(contrast(color, PAGE_DARK) >= 3, `${color} on the dark page`);
  }
});

test("the ramp still runs from green at the ground to blue at cruise", () => {
  for (const theme of ["dark", "light"] as const) {
    const ramp = altitudeRamp(theme);
    const [low, high] = [ramp[0], ramp[ramp.length - 1]];
    assert.ok(low[1] > low[0] && low[1] > low[2] - 20, `${theme} starts green`);
    assert.ok(high[2] > high[0] && high[2] > high[1], `${theme} ends blue`);
  }
});

test("the map's theme picks the ramp", () => {
  setAltitudeTheme("light");
  const light = altitudeToColor(11_000);
  setAltitudeTheme("dark");
  const dark = altitudeToColor(11_000);
  assert.notDeepEqual(light, dark);
  assert.deepEqual(altitudeToColor(null), [100, 100, 100, 200]);
});

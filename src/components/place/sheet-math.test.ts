import assert from "node:assert/strict";
import test from "node:test";

import { nearestDetent, sheetDetents } from "./sheet-math";

const phone = { height: 800, viewport: 844, peek: 260 };

test("the sheet rests at its peek, half the screen, or fully open", () => {
  assert.deepEqual(sheetDetents(phone), { full: 0, half: 378, peek: 540 });
});

test("a release settles on the nearest height", () => {
  const detents = sheetDetents(phone);
  assert.equal(nearestDetent(detents, 520), "peek");
  assert.equal(nearestDetent(detents, 400), "half");
  assert.equal(nearestDetent(detents, 90), "full");
});

test("a peek taller than half the screen has no half step", () => {
  const detents = sheetDetents({ height: 800, viewport: 844, peek: 450 });
  assert.equal(detents.half, detents.peek);
  assert.equal(nearestDetent(detents, 340), "peek");
  assert.equal(nearestDetent(detents, 120), "full");
});

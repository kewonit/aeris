import assert from "node:assert/strict";
import test from "node:test";

import { whenClickUnhandled } from "./map-click";

/** A click as MapLibre hands it to each listener in turn. */
function click() {
  let prevented = false;
  return {
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
  };
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a click no other listener takes runs once they have all seen it", async () => {
  const event = click();
  const ran: string[] = [];
  whenClickUnhandled(event, () => ran.push("airspace"));
  ran.push("later listener");
  await settled();
  assert.deepEqual(ran, ["later listener", "airspace"]);
});

test("a click a later listener takes does not run", async () => {
  // The airspace listener comes first, the aircraft's after it.
  const event = click();
  let ran = false;
  whenClickUnhandled(event, () => {
    ran = true;
  });
  event.preventDefault();
  await settled();
  assert.equal(ran, false);
});

test("a click an earlier listener took does not run", async () => {
  const event = click();
  event.preventDefault();
  let ran = false;
  whenClickUnhandled(event, () => {
    ran = true;
  });
  await settled();
  assert.equal(ran, false);
});

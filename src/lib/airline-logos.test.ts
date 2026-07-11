import assert from "node:assert/strict";
import test from "node:test";

import { airlineLogoCandidates } from "./airline-logos";

test("Korean Air prefers the bundled PNG before probing SVG", () => {
  assert.deepEqual(airlineLogoCandidates("Korean Air", "KAL208").slice(0, 2), [
    "/airline-logos/korean-air.png",
    "/airline-logos/korean-air.svg",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createFollowPause } from "./fpv-follow";

test("following pauses while the map is moved by hand, and resumes after an idle wait", () => {
  const pause = createFollowPause(1_500);
  assert.equal(pause.paused(0), false);

  pause.interact(1_000);
  assert.equal(pause.paused(1_000), true);
  assert.equal(pause.paused(2_400), true);
  // Moving again restarts the wait.
  pause.interact(2_400);
  assert.equal(pause.paused(2_600), true);
  assert.equal(pause.paused(3_899), true);
  assert.equal(pause.paused(3_900), false);
  assert.equal(pause.paused(10_000), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { shouldRenderFullscreenToggle } from "./camera-controls";

test("fullscreen toggle waits until browser capability is known after mount", () => {
  assert.equal(shouldRenderFullscreenToggle(false, false), false);
  assert.equal(shouldRenderFullscreenToggle(false, true), false);
  assert.equal(shouldRenderFullscreenToggle(true, false), false);
  assert.equal(shouldRenderFullscreenToggle(true, true), true);
});

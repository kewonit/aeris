import assert from "node:assert/strict";
import test from "node:test";
import packageMetadata from "../../package.json";
import { CHANGELOG } from "@/components/ui/control-panel-settings";

test("top changelog version matches package metadata", () => {
  assert.equal(CHANGELOG[0]?.version, packageMetadata.version);
});

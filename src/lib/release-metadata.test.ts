import assert from "node:assert/strict";
import test from "node:test";
import packageMetadata from "../../package.json";
import { CHANGELOG } from "@/components/ui/control-panel-settings";

test("top changelog version matches package metadata", () => {
  const currentRelease = CHANGELOG[0];

  assert.ok(currentRelease);
  assert.equal(currentRelease.version, packageMetadata.version);
  assert.deepEqual(
    currentRelease.entries.map((entry) => entry.title),
    [
      "Open aviation data updates",
      "Aircraft data and route trust",
      "Simpler aircraft details",
    ],
  );
});

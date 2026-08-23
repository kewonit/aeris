import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AviationDataManifest } from "./lib";

const DATA_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/data/aviation",
);

test("committed manifest records source licenses and attribution", async () => {
  const [manifestContent, notice] = await Promise.all([
    readFile(path.join(DATA_DIRECTORY, "manifest.json"), "utf8"),
    readFile(path.join(DATA_DIRECTORY, "NOTICE.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestContent) as AviationDataManifest;

  assert.deepEqual(Object.keys(manifest.sources).sort(), [
    "faa",
    "mictronics",
    "ourairports",
  ]);
  for (const source of Object.values(manifest.sources)) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(source.license);
    assert.match(source.licenseUrl, /^https:\/\//);
    assert.ok(source.attribution);
    assert.match(notice, new RegExp(escapePattern(source.attribution)));
    assert.match(notice, new RegExp(`License: ${escapePattern(source.license)}\\.`));
  }
});

test("committed manifest documents the personal fields that stay excluded", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(DATA_DIRECTORY, "manifest.json"), "utf8"),
  ) as AviationDataManifest;

  assert.deepEqual(manifest.privacy.excludedFaaFields, [
    "owner name",
    "street address",
    "city",
    "state",
    "postal code",
    "county",
    "other names",
  ]);
  const includedFields = manifest.privacy.includedAircraftFields.map((field) =>
    field.toLowerCase(),
  );
  for (const personalField of manifest.privacy.excludedFaaFields) {
    assert.ok(!includedFields.includes(personalField));
  }
});

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import manifest from "./manifest";

test("web app manifest references complete, local install icon sets", () => {
  const icons = manifest().icons ?? [];

  assert.deepEqual(
    icons.map(({ sizes, purpose }) => `${sizes}:${purpose}`),
    ["192x192:any", "192x192:maskable", "512x512:any", "512x512:maskable"],
  );

  for (const icon of icons) {
    assert.equal(icon.type, "image/png");
    assert.ok(icon.src.startsWith("/favicon/"));
    assert.ok(
      existsSync(path.join(process.cwd(), "public", icon.src)),
      `Missing manifest icon: ${icon.src}`,
    );
  }
});

test("root favicon stays synchronized with the public legacy fallback", () => {
  assert.deepEqual(
    readFileSync(path.join(process.cwd(), "src/app/favicon.ico")),
    readFileSync(path.join(process.cwd(), "public/favicon/favicon.ico")),
  );
});

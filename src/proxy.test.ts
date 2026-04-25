import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

test("proxy canonicalizes legacy city query links in one hop", async () => {
  const moduleExports = (await import("./proxy").catch(
    () => ({}) as Record<string, unknown>,
  )) as {
    config?: unknown;
    proxy?: (request: NextRequest) => Response | Promise<Response>;
  };

  assert.equal(typeof moduleExports.proxy, "function");

  const bomResponse = await moduleExports.proxy!(
    new NextRequest("https://aeris.edbn.me/?city=bom&fpv=abc123"),
  );
  assert.equal(bomResponse.status, 308);
  assert.equal(
    bomResponse.headers.get("location"),
    "https://aeris.edbn.me/city/bom?fpv=abc123",
  );

  const aliasResponse = await moduleExports.proxy!(
    new NextRequest("https://aeris.edbn.me/?city=nyc"),
  );
  assert.equal(aliasResponse.status, 308);
  assert.equal(
    aliasResponse.headers.get("location"),
    "https://aeris.edbn.me/city/jfk",
  );

  const unknownResponse = await moduleExports.proxy!(
    new NextRequest("https://aeris.edbn.me/?city=ZZZ&fpv=abc123"),
  );
  assert.equal(unknownResponse.status, 308);
  assert.equal(
    unknownResponse.headers.get("location"),
    "https://aeris.edbn.me/city/zzz?fpv=abc123",
  );
});

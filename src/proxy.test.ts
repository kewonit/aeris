import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "./proxy";

test("proxy canonicalizes legacy city query links in one hop", async () => {
  const cases = [
    ["https://aeris.edbn.me/?city=bom&fpv=abc123", "https://aeris.edbn.me/city/bom?fpv=abc123"],
    ["https://aeris.edbn.me/?city=nyc", "https://aeris.edbn.me/city/jfk"],
    ["https://aeris.edbn.me/?city=ZZZ&fpv=abc123", "https://aeris.edbn.me/city/zzz?fpv=abc123"],
  ];

  for (const [from, to] of cases) {
    const response = await proxy(new NextRequest(from));
    assert.equal(response.status, 308, from);
    assert.equal(response.headers.get("location"), to);
  }
});

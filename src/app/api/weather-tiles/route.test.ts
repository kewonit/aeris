import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";

import { NextRequest } from "next/server";
import { GET } from "./route";

const tile = (query: string) =>
  new NextRequest(`https://aeris.edbn.me/api/weather-tiles?${query}`);

/** Every chunk of a PNG, with whether its CRC matches. */
function pngChunks(bytes: Buffer): { type: string; crcOk: boolean }[] {
  const chunks: { type: string; crcOk: boolean }[] = [];
  for (let i = 8; i < bytes.length; ) {
    const length = bytes.readUInt32BE(i);
    const body = bytes.subarray(i + 4, i + 8 + length);
    chunks.push({
      type: body.subarray(0, 4).toString("latin1"),
      crcOk: crc32(body) === bytes.readUInt32BE(i + 8 + length),
    });
    i += 12 + length;
  }
  return chunks;
}

async function withFetch<T>(
  stub: typeof fetch,
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return stub(input, init);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("a radar tile is fetched by its frame id", async () => {
  await withFetch(
    async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    async (calls) => {
      const response = await GET(tile("frame=eeb611c424e7&z=5&x=5&y=12"));
      assert.equal(response.status, 200);
      assert.deepEqual(calls, [
        "https://tilecache.rainviewer.com/v2/radar/eeb611c424e7/256/5/5/12/2/1_1.png",
      ]);
    },
  );
});

test("a frame id that is not a hash is refused before any fetch", async () => {
  await withFetch(
    async () => new Response(null, { status: 200 }),
    async (calls) => {
      for (const frame of ["../../x", "eeb6", "e%2Fb611c424e7"]) {
        const response = await GET(tile(`frame=${frame}&z=5&x=5&y=12`));
        assert.equal(response.status, 400, frame);
      }
      assert.equal((await GET(tile("z=5&x=5&y=12"))).status, 400);
      assert.deepEqual(calls, []);
    },
  );
});

test("a missing tile is a transparent PNG a browser can decode", async () => {
  await withFetch(
    async () => new Response(null, { status: 410 }),
    async () => {
      const response = await GET(tile("frame=eeb611c424e7&z=5&x=5&y=12"));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "image/png");
      const bytes = Buffer.from(await response.arrayBuffer());
      const chunks = pngChunks(bytes);
      assert.deepEqual(
        chunks.map((c) => c.type),
        ["IHDR", "IDAT", "IEND"],
      );
      assert.ok(chunks.every((c) => c.crcOk));
    },
  );
});

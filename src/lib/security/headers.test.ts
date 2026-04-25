import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../../../next.config";

test("global API no-store headers exclude the route lookup endpoint", async () => {
  const headerConfigs = await nextConfig.headers?.();
  const noStoreApiHeaders = headerConfigs?.filter((entry) =>
    entry.headers.some(
      (header) =>
        header.key.toLowerCase() === "cache-control" &&
        header.value.includes("no-store"),
    ),
  );

  assert.ok(noStoreApiHeaders, "Expected configured API cache headers");
  assert.ok(
    noStoreApiHeaders.every((entry) => entry.source !== "/api/:path*"),
    "A generic /api/:path* no-store rule overrides /api/routes cache headers",
  );
});

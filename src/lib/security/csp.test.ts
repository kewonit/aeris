import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../../../next.config";
import {
  getDirectTraceProviderPolicies,
} from "../trails/providers";

function getConnectSrcEntries(cspHeader: string): string[] {
  const match = cspHeader.match(/connect-src\s+([^;]+);?/);
  return match ? match[1].trim().split(/\s+/) : [];
}

test("browser-direct trail providers are allowed by the CSP connect-src list", async () => {
  const headerConfigs = await nextConfig.headers?.();
  const globalHeaders = headerConfigs?.find((entry) => entry.source === "/(.*)");
  const cspHeader = globalHeaders?.headers.find(
    (header) => header.key === "Content-Security-Policy",
  )?.value;

  assert.ok(cspHeader, "Expected a Content-Security-Policy header");

  const connectSrcEntries = getConnectSrcEntries(cspHeader);

  for (const provider of getDirectTraceProviderPolicies()) {
    const origin = new URL(provider.baseUrl).origin;
    assert.ok(
      connectSrcEntries.includes(origin),
      `Expected CSP connect-src to allow ${origin} for ${provider.id}`,
    );
  }
});
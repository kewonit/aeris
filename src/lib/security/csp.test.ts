import assert from "node:assert/strict";
import test from "node:test";

import nextConfig, { getFlightDataConnectSrc } from "../../../next.config";
import {
  getDirectTraceProviderPolicies,
} from "../trails/providers";

function getConnectSrcEntries(cspHeader: string): string[] {
  const match = cspHeader.match(/connect-src\s+([^;]+);?/);
  return match ? match[1].trim().split(/\s+/) : [];
}

test("browser-direct flight providers require an explicit authorization gate", async () => {
  const headerConfigs = await nextConfig.headers?.();
  const globalHeaders = headerConfigs?.find((entry) => entry.source === "/(.*)");
  const cspHeader = globalHeaders?.headers.find(
    (header) => header.key === "Content-Security-Policy",
  )?.value;

  assert.ok(cspHeader, "Expected a Content-Security-Policy header");

  const connectSrcEntries = getConnectSrcEntries(cspHeader);

  for (const provider of getDirectTraceProviderPolicies()) {
    const origin = new URL(provider.baseUrl).origin;
    assert.equal(connectSrcEntries.includes(origin), false);
  }
});

test("authorized direct providers and the configured WebSocket get scoped CSP entries", () => {
  const entries = getFlightDataConnectSrc({
    NEXT_PUBLIC_AUTHORIZED_DIRECT_FLIGHT_DATA: "true",
    NEXT_PUBLIC_FLIGHT_STREAM_URL: "wss://relay.example.test/v1/live",
  });
  assert.ok(entries.includes("wss://relay.example.test"));
  for (const provider of getDirectTraceProviderPolicies()) {
    assert.ok(entries.includes(new URL(provider.baseUrl).origin));
  }
});

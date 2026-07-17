import assert from "node:assert/strict";
import test from "node:test";

import {
  ATC_STALL_TIMEOUT_MS,
  ATC_STARTUP_TIMEOUT_MS,
  canReuseAtcAudioElement,
  getAtcReconnectDelayMs,
  isAtcAutoplayBlock,
  shouldArmAtcStallTimeout,
  shouldSwitchToAtcManifestCandidate,
} from "@/hooks/use-atc-stream";

test("ATC reconnects use bounded exponential backoff", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(getAtcReconnectDelayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000],
  );
  assert.equal(getAtcReconnectDelayMs(10), 30_000);
});

test("ATC reconnect delay normalizes invalid negative attempts", () => {
  assert.equal(getAtcReconnectDelayMs(-3), 1_000);
  assert.equal(getAtcReconnectDelayMs(Number.NaN), 1_000);
});

test("ATC allows low-bitrate startup but bounds sustained playback stalls", () => {
  assert.equal(ATC_STARTUP_TIMEOUT_MS, 45_000);
  assert.equal(ATC_STALL_TIMEOUT_MS, 12_000);
  assert.equal(shouldArmAtcStallTimeout(false), false);
  assert.equal(shouldArmAtcStallTimeout(true), true);
});

test("only browser NotAllowedError is classified as autoplay blocking", () => {
  const blocked = new Error("play() requires a user gesture");
  blocked.name = "NotAllowedError";
  const unsupported = new Error("unsupported media");
  unsupported.name = "NotSupportedError";
  const blockedDomException = new DOMException(
    "play() requires a user gesture",
    "NotAllowedError",
  );

  assert.equal(isAtcAutoplayBlock(blocked), true);
  assert.equal(isAtcAutoplayBlock(blockedDomException), true);
  assert.equal(isAtcAutoplayBlock(unsupported), false);
  assert.equal(isAtcAutoplayBlock(new DOMException("Aborted", "AbortError")), false);
});

test("ATC reuses the gesture-authorized audio element only across safe CORS transitions", () => {
  assert.equal(canReuseAtcAudioElement(null, true, false), false);
  assert.equal(canReuseAtcAudioElement(true, true, true), true);
  assert.equal(canReuseAtcAudioElement(false, false, true), true);
  assert.equal(canReuseAtcAudioElement(false, true, true), true);
  assert.equal(canReuseAtcAudioElement(true, false, false), true);
  assert.equal(canReuseAtcAudioElement(true, false, true), false);
});

test("an authoritative manifest replaces only a provisional source", () => {
  assert.equal(
    shouldSwitchToAtcManifestCandidate("liveatc:tower", "custom:tower", false),
    true,
  );
  assert.equal(
    shouldSwitchToAtcManifestCandidate("liveatc:tower", "custom:tower", true),
    false,
  );
  assert.equal(
    shouldSwitchToAtcManifestCandidate("custom:tower", "custom:tower", false),
    false,
  );
  assert.equal(shouldSwitchToAtcManifestCandidate(null, null, false), false);
});

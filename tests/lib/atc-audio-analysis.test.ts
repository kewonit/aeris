import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrCreateAtcAudioConnection,
  isAtcAudioElementCaptured,
  releaseAtcAudioConnection,
  retireAtcAudioElement,
} from "@/lib/atc-audio-analysis";

test("captured ATC audio stays audible without a visualizer and retires its graph", async () => {
  const originalAudioContext = Object.getOwnPropertyDescriptor(
    globalThis,
    "AudioContext",
  );
  let createSourceCalls = 0;
  let resumeCalls = 0;
  let suspendCalls = 0;
  let sourceDisconnects = 0;
  let analyserDisconnects = 0;
  let resolveFirstSuspend: (() => void) | null = null;

  class FakeAudioContext {
    state: AudioContextState = "running";
    destination = {} as AudioDestinationNode;

    createMediaElementSource() {
      createSourceCalls += 1;
      return {
        connect() {},
        disconnect() {
          sourceDisconnects += 1;
        },
      } as unknown as MediaElementAudioSourceNode;
    }

    createAnalyser() {
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        connect() {},
        disconnect() {
          analyserDisconnects += 1;
        },
      } as unknown as AnalyserNode;
    }

    resume() {
      resumeCalls += 1;
      this.state = "running";
      return Promise.resolve();
    }

    suspend() {
      suspendCalls += 1;
      if (suspendCalls === 1) {
        return new Promise<void>((resolve) => {
          resolveFirstSuspend = () => {
            this.state = "suspended";
            resolve();
          };
        });
      }
      this.state = "suspended";
      return Promise.resolve();
    }
  }

  class FakeAudioElement extends EventTarget {
    paused = false;
    ended = false;
  }

  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  });

  try {
    const audio = new FakeAudioElement() as unknown as HTMLAudioElement;
    const first = getOrCreateAtcAudioConnection(audio);
    const second = getOrCreateAtcAudioConnection(audio);

    assert.ok(first);
    assert.equal(second, first);
    assert.equal(createSourceCalls, 1);
    assert.equal(isAtcAudioElementCaptured(audio), true);

    releaseAtcAudioConnection(audio);
    releaseAtcAudioConnection(audio);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      suspendCalls,
      0,
      "unmounting every visualizer must not mute active playback",
    );

    audio.dispatchEvent(new Event("pause"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(suspendCalls, 1);
    audio.dispatchEvent(new Event("play"));
    const finishFirstSuspend = resolveFirstSuspend as (() => void) | null;
    assert.ok(finishFirstSuspend);
    finishFirstSuspend();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(resumeCalls, 1);

    retireAtcAudioElement(audio);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(isAtcAudioElementCaptured(audio), false);
    assert.equal(sourceDisconnects, 1);
    assert.equal(analyserDisconnects, 1);
  } finally {
    if (originalAudioContext) {
      Object.defineProperty(globalThis, "AudioContext", originalAudioContext);
    } else {
      Reflect.deleteProperty(globalThis, "AudioContext");
    }
  }
});

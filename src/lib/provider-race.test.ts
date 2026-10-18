import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { raceProviders, type Candidate } from "./provider-race";

/** A candidate that answers after `afterMs`, or fails if `error` is set. */
function candidate(
  id: string,
  afterMs: number,
  options: { error?: Error; value?: string; log?: string[] } = {},
): Candidate<string> {
  return {
    id,
    run: (signal) =>
      new Promise((resolve, reject) => {
        options.log?.push(`start ${id}`);
        const timer = setTimeout(() => {
          if (options.error) reject(options.error);
          else resolve(options.value ?? id);
        }, afterMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          options.log?.push(`abort ${id}`);
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test("a quick answer from the front runner is the only request made", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());
  const log: string[] = [];
  const race = raceProviders(
    [candidate("a", 300, { log }), candidate("b", 100, { log })],
    { hedgeDelayMs: 1_200 },
  );
  mock.timers.tick(300);
  await settle();
  const outcome = await race;
  assert.equal(outcome.winner?.id, "a");
  assert.equal(outcome.winner?.latencyMs, 300);
  assert.deepEqual(log, ["start a"]);
});

test("a slow front runner gets a hedge, whose answer wins and aborts it", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());
  const log: string[] = [];
  const race = raceProviders(
    [candidate("slow", 6_000, { log }), candidate("fast", 200, { log })],
    { hedgeDelayMs: 1_200 },
  );
  mock.timers.tick(1_199);
  await settle();
  assert.deepEqual(log, ["start slow"]);
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(log, ["start slow", "start fast"]);
  mock.timers.tick(200);
  await settle();
  const outcome = await race;
  assert.equal(outcome.winner?.id, "fast");
  assert.equal(outcome.winner?.latencyMs, 200);
  assert.deepEqual(log, ["start slow", "start fast", "abort slow"]);
  // The abort was the race's doing, not a failure of the slow provider.
  assert.deepEqual(outcome.failures, []);
});

test("a failure starts the next candidate at once and is reported", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());
  const log: string[] = [];
  const boom = new Error("boom");
  const race = raceProviders(
    [candidate("a", 100, { error: boom, log }), candidate("b", 100, { log })],
    { hedgeDelayMs: 1_200 },
  );
  mock.timers.tick(100);
  await settle();
  assert.deepEqual(log, ["start a", "start b"]);
  mock.timers.tick(100);
  await settle();
  const outcome = await race;
  assert.equal(outcome.winner?.id, "b");
  assert.equal(outcome.failures.length, 1);
  assert.equal(outcome.failures[0].id, "a");
  assert.equal(outcome.failures[0].error, boom);
});

test("a miss keeps the race going and is listed, and every answer's time is kept", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());
  const race = raceProviders(
    [candidate("a", 100, { value: "" }), candidate("b", 100, { value: "hit" })],
    { hedgeDelayMs: 1_200, accept: (value) => value.length > 0 },
  );
  mock.timers.tick(100);
  await settle();
  mock.timers.tick(100);
  await settle();
  const outcome = await race;
  assert.equal(outcome.winner?.id, "b");
  assert.deepEqual(outcome.misses, ["a"]);
  assert.deepEqual([...outcome.latencies], [["a", 100], ["b", 100]]);
});

test("when everyone fails or misses there is no winner", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());
  const race = raceProviders(
    [
      candidate("a", 100, { error: new Error("down") }),
      candidate("b", 100, { value: "" }),
    ],
    { hedgeDelayMs: 1_200, accept: (value) => value.length > 0 },
  );
  mock.timers.tick(100);
  await settle();
  mock.timers.tick(100);
  await settle();
  const outcome = await race;
  assert.equal(outcome.winner, null);
  assert.deepEqual(outcome.misses, ["b"]);
  assert.equal(outcome.failures[0].id, "a");
});

test("the caller's abort cancels every request and rejects", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());
  const log: string[] = [];
  const controller = new AbortController();
  const race = raceProviders(
    [candidate("a", 5_000, { log }), candidate("b", 5_000, { log })],
    { hedgeDelayMs: 1_200, signal: controller.signal },
  );
  mock.timers.tick(1_200);
  await settle();
  controller.abort();
  await assert.rejects(race, (error: Error) => error.name === "AbortError");
  assert.deepEqual(log, ["start a", "start b", "abort a", "abort b"]);
});

test("starting everyone at once measures them all", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());
  const log: string[] = [];
  const race = raceProviders(
    [candidate("a", 400, { log }), candidate("b", 150, { log })],
    { hedgeDelayMs: 1_200, startAtOnce: 2 },
  );
  await settle();
  assert.deepEqual(log, ["start a", "start b"]);
  mock.timers.tick(150);
  await settle();
  const outcome = await race;
  assert.equal(outcome.winner?.id, "b");
  assert.deepEqual(log, ["start a", "start b", "abort a"]);
});

test("no candidates is an empty outcome", async () => {
  const outcome = await raceProviders([], { hedgeDelayMs: 1_200 });
  assert.equal(outcome.winner, null);
  assert.deepEqual(outcome.failures, []);
});

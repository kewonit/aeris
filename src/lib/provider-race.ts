// ── Hedged provider requests ───────────────────────────────────────────
//
// Providers are asked one at a time, but a slow one does not hold the
// rest up: when the one in front has not answered within the hedge delay,
// the next is started too, and the first acceptable answer wins. The
// losers are aborted, and an abort of that kind is the race's doing, not
// the provider's, so it is never reported as a failure.
// ────────────────────────────────────────────────────────────────────────

export type Candidate<T> = {
  id: string;
  run: (signal: AbortSignal) => Promise<T>;
};

export type RaceOptions<T> = {
  /** How long the candidate in front gets before the next one is started. */
  hedgeDelayMs: number;
  /** Whether an answer counts; a miss keeps the race waiting on the rest. */
  accept?: (value: T) => boolean;
  /** How many candidates to start at once, to measure them; one by default. */
  startAtOnce?: number;
  /** The caller's own cancellation. */
  signal?: AbortSignal;
};

export type RaceFailure = { id: string; error: Error; latencyMs: number };

export type RaceOutcome<T> = {
  winner: { id: string; value: T; latencyMs: number } | null;
  /** Candidates that answered with something not accepted. */
  misses: string[];
  failures: RaceFailure[];
  /** How long every answer took, accepted or not, for the health record. */
  latencies: Map<string, number>;
};

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Races the candidates for the first accepted answer. Resolves with a
 * null winner when every candidate has failed or missed; rejects only
 * when the caller's own signal aborts.
 */
export function raceProviders<T>(
  candidates: Candidate<T>[],
  options: RaceOptions<T>,
): Promise<RaceOutcome<T>> {
  const accept = options.accept ?? (() => true);
  const outcome: RaceOutcome<T> = {
    winner: null,
    misses: [],
    failures: [],
    latencies: new Map(),
  };

  return new Promise<RaceOutcome<T>>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    if (candidates.length === 0) {
      resolve(outcome);
      return;
    }

    const controllers = new Map<string, AbortController>();
    let nextIndex = 0;
    let pending = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

    const clearHedge = () => {
      if (hedgeTimer !== null) {
        clearTimeout(hedgeTimer);
        hedgeTimer = null;
      }
    };

    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearHedge();
      options.signal?.removeEventListener("abort", onExternalAbort);
      for (const controller of controllers.values()) controller.abort();
      result();
    };

    const onExternalAbort = () => finish(() => reject(abortError()));

    const scheduleHedge = () => {
      clearHedge();
      if (settled || nextIndex >= candidates.length) return;
      hedgeTimer = setTimeout(startNext, options.hedgeDelayMs);
    };

    const settleIfDone = () => {
      if (pending === 0 && nextIndex >= candidates.length) {
        finish(() => resolve(outcome));
      }
    };

    // After a failure or a miss: with nothing else in flight the next
    // candidate starts straight away; with another still answering, the
    // next waits its turn on the hedge timer, so one quick failure does
    // not pile requests onto the providers further down.
    const moveOn = () => {
      if (pending === 0) startNext();
      else if (hedgeTimer === null) scheduleHedge();
      settleIfDone();
    };

    function startNext(): void {
      clearHedge();
      if (settled || nextIndex >= candidates.length) return;
      const candidate = candidates[nextIndex];
      nextIndex += 1;
      const controller = new AbortController();
      controllers.set(candidate.id, controller);
      pending += 1;
      const startedAt = Date.now();

      candidate.run(controller.signal).then(
        (value) => {
          pending -= 1;
          controllers.delete(candidate.id);
          if (settled) return;
          const latencyMs = Date.now() - startedAt;
          outcome.latencies.set(candidate.id, latencyMs);
          if (accept(value)) {
            outcome.winner = { id: candidate.id, value, latencyMs };
            finish(() => resolve(outcome));
            return;
          }
          outcome.misses.push(candidate.id);
          moveOn();
        },
        (error: unknown) => {
          pending -= 1;
          controllers.delete(candidate.id);
          if (settled) return;
          if (!isAbortError(error) || !controller.signal.aborted) {
            outcome.failures.push({
              id: candidate.id,
              error: error instanceof Error ? error : new Error(String(error)),
              latencyMs: Date.now() - startedAt,
            });
          }
          moveOn();
        },
      );

      if (nextIndex < (options.startAtOnce ?? 1)) startNext();
      else scheduleHedge();
    }

    options.signal?.addEventListener("abort", onExternalAbort);
    startNext();
  });
}

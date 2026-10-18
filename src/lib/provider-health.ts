// ── Provider health ────────────────────────────────────────────────────
//
// Remembers how quickly each provider has been answering and whether it
// has been failing, so the one that was fast a moment ago is asked first.
// The record is kept in local storage for a quarter of an hour, so a
// reload starts on the right provider instead of learning it again.
// ────────────────────────────────────────────────────────────────────────

export type ProviderRecord = {
  /** Exponentially weighted average answer time, or null before one. */
  latencyMs: number | null;
  /** Failures since the last answer. */
  failures: number;
  lastAnswerAt: number;
  lastFailureAt: number;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const PROVIDER_HEALTH_KEY = "aeris:provider-health";
/** A record older than this is forgotten; the network may have changed. */
export const PROVIDER_HEALTH_TTL_MS = 15 * 60_000;
/** How much the newest answer time counts against the average. */
const LATENCY_ALPHA = 0.3;
/**
 * Answer times within this of each other count as equal when ordering,
 * so two quick providers keep their order instead of swapping places
 * over a few milliseconds.
 */
const LATENCY_STEP_MS = 250;

type Stored = { savedAt: number; records: Record<string, ProviderRecord> };

function freshRecord(): ProviderRecord {
  return { latencyMs: null, failures: 0, lastAnswerAt: 0, lastFailureAt: 0 };
}

function isRecord(value: unknown): value is ProviderRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    (r.latencyMs === null || typeof r.latencyMs === "number") &&
    typeof r.failures === "number" &&
    typeof r.lastAnswerAt === "number" &&
    typeof r.lastFailureAt === "number"
  );
}

export function createProviderHealth(
  storage: StorageLike | null = null,
  now: () => number = () => Date.now(),
) {
  let records = new Map<string, ProviderRecord>();

  function load(): void {
    if (!storage) return;
    try {
      const raw = storage.getItem(PROVIDER_HEALTH_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      if (
        typeof parsed.savedAt !== "number" ||
        now() - parsed.savedAt > PROVIDER_HEALTH_TTL_MS ||
        !parsed.records ||
        typeof parsed.records !== "object"
      ) {
        return;
      }
      for (const [id, record] of Object.entries(parsed.records)) {
        if (isRecord(record)) records.set(id, record);
      }
    } catch {
      // Unreadable storage is the same as none.
    }
  }

  function save(): void {
    if (!storage) return;
    try {
      const stored: Stored = {
        savedAt: now(),
        records: Object.fromEntries(records),
      };
      storage.setItem(PROVIDER_HEALTH_KEY, JSON.stringify(stored));
    } catch {
      // Full or blocked storage only loses the memory across reloads.
    }
  }

  function record(id: string): ProviderRecord {
    let r = records.get(id);
    if (!r) {
      r = freshRecord();
      records.set(id, r);
    }
    return r;
  }

  load();

  return {
    /** A provider answered, acceptably or not, in this long. */
    noteAnswer(id: string, latencyMs: number): void {
      if (!(latencyMs >= 0)) return;
      const r = record(id);
      r.latencyMs =
        r.latencyMs === null
          ? latencyMs
          : r.latencyMs + LATENCY_ALPHA * (latencyMs - r.latencyMs);
      r.failures = 0;
      r.lastAnswerAt = now();
      save();
    },

    noteFailure(id: string): void {
      const r = record(id);
      r.failures += 1;
      r.lastFailureAt = now();
      save();
    },

    get(id: string): ProviderRecord | undefined {
      return records.get(id);
    },

    /**
     * The providers to ask, quickest first: those answering lately by
     * their answer time, then those never tried in the order given, then
     * those failing, the least failing first.
     */
    order(ids: readonly string[]): string[] {
      const at = now();
      const rank = (id: string): [number, number, number] => {
        const r = records.get(id);
        const index = ids.indexOf(id);
        if (!r || (r.latencyMs === null && r.failures === 0)) {
          return [1, index, 0];
        }
        const answering =
          r.failures === 0 && at - r.lastAnswerAt <= PROVIDER_HEALTH_TTL_MS;
        if (answering) {
          const step = Math.round((r.latencyMs ?? Infinity) / LATENCY_STEP_MS);
          return [0, step, index];
        }
        return [2, r.failures, r.latencyMs ?? Infinity];
      };
      return [...ids].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
      });
    },

    reset(): void {
      records = new Map();
      save();
    },
  };
}

export type ProviderHealth = ReturnType<typeof createProviderHealth>;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** The health record shared by every lookup in the page. */
export const providerHealth = createProviderHealth(browserStorage());

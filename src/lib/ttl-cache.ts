/** A size-bounded map whose entries expire. Evicts the oldest insert first. */
export function createTtlCache<V>(maxEntries: number) {
  const entries = new Map<string, { value: V; expiresAt: number }>();

  return {
    get(key: string): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: V, ttlMs: number): void {
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value!);
      }
    },
    clear(): void {
      entries.clear();
    },
  };
}

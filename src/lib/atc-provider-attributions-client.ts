import type { AtcProviderAttribution } from "./atc-types";

export type { AtcProviderAttribution } from "./atc-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeAttributionUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Narrow the public sources-manifest response before rendering external links.
 * A malformed entry is omitted so the About panel remains usable if a stale
 * deployment or intermediary returns an unexpected response.
 */
export function parseAtcProviderAttributions(
  payload: unknown,
): AtcProviderAttribution[] {
  if (!isRecord(payload) || !Array.isArray(payload.providers)) return [];

  const seenIds = new Set<string>();
  const providers: AtcProviderAttribution[] = [];

  for (const entry of payload.providers) {
    if (!isRecord(entry)) continue;

    const { id, label, attributionUrl } = entry;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      seenIds.has(id) ||
      typeof label !== "string" ||
      label.length === 0 ||
      typeof attributionUrl !== "string" ||
      !isSafeAttributionUrl(attributionUrl)
    ) {
      continue;
    }

    seenIds.add(id);
    providers.push({ id, label, attributionUrl });
  }

  return providers;
}

/** Fetch provider credits without surfacing availability errors in About. */
export async function loadAtcProviderAttributions(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AtcProviderAttribution[]> {
  try {
    const response = await fetcher("/api/atc/sources", { signal });
    if (!response.ok) return [];
    return parseAtcProviderAttributions(await response.json());
  } catch {
    return [];
  }
}

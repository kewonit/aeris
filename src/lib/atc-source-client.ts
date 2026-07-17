import type {
  AtcProviderAttribution,
  AtcSourceCandidate,
  AtcSourcesManifest,
} from "./atc-types";

const manifestCache = new Map<string, AtcSourcesManifest>();
const manifestRequests = new Map<string, Promise<AtcSourcesManifest>>();

function isProvider(value: unknown): value is AtcProviderAttribution {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<AtcProviderAttribution>;
  return (
    typeof provider.id === "string" &&
    typeof provider.label === "string" &&
    typeof provider.attributionUrl === "string"
  );
}

function isCandidate(value: unknown): value is AtcSourceCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AtcSourceCandidate>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.feedId === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.providerLabel === "string" &&
    typeof candidate.attributionUrl === "string" &&
    typeof candidate.priority === "number" &&
    typeof candidate.analyzable === "boolean" &&
    typeof candidate.playbackUrl === "string"
  );
}

function parseManifest(value: unknown): AtcSourcesManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid ATC source manifest.");
  }

  const manifest = value as Partial<AtcSourcesManifest>;
  if (!Array.isArray(manifest.providers) || !manifest.providers.every(isProvider)) {
    throw new Error("Invalid ATC provider manifest.");
  }
  if (!manifest.sourcesByFeed || typeof manifest.sourcesByFeed !== "object") {
    throw new Error("Invalid ATC source mapping.");
  }

  for (const candidates of Object.values(manifest.sourcesByFeed)) {
    if (!Array.isArray(candidates) || !candidates.every(isCandidate)) {
      throw new Error("Invalid ATC source candidate.");
    }
  }

  return manifest as AtcSourcesManifest;
}

export function getCachedAtcSources(
  icao: string,
): AtcSourcesManifest | null {
  return manifestCache.get(icao.trim().toUpperCase()) ?? null;
}

export function loadAtcSources(
  icao: string,
  options: { force?: boolean } = {},
): Promise<AtcSourcesManifest> {
  const normalizedIcao = icao.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(normalizedIcao)) {
    return Promise.reject(new Error("Invalid ICAO code."));
  }

  if (!options.force) {
    const cached = manifestCache.get(normalizedIcao);
    if (cached) return Promise.resolve(cached);
    const pending = manifestRequests.get(normalizedIcao);
    if (pending) return pending;
  }

  const request: Promise<AtcSourcesManifest> = fetch(
    `/api/atc/sources?icao=${encodeURIComponent(normalizedIcao)}`,
    { cache: "force-cache" },
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`ATC source manifest ${response.status}`);
      }
      return parseManifest(await response.json());
    })
    .then((manifest) => {
      manifestCache.set(normalizedIcao, manifest);
      return manifest;
    })
    .finally(() => {
      if (manifestRequests.get(normalizedIcao) === request) {
        manifestRequests.delete(normalizedIcao);
      }
    });

  manifestRequests.set(normalizedIcao, request);
  return request;
}

export function prefetchAtcSources(icao: string): void {
  void loadAtcSources(icao).catch(() => {
    // Playback has a built-in LiveATC candidate and can retry the manifest.
  });
}

export const __atcSourceClientInternals = {
  parseManifest,
  reset() {
    manifestCache.clear();
    manifestRequests.clear();
  },
};

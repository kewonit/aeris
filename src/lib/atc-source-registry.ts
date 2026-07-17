import {
  ATC_FEEDS,
  getBuiltInAtcSourceId,
  getLiveAtcMountPoint,
} from "./atc-feeds";
import type {
  AtcProviderAttribution,
  AtcSourceCandidate,
} from "./atc-types";

export const LIVEATC_PROVIDER: AtcProviderAttribution = {
  id: "liveatc",
  label: "LiveATC.net",
  attributionUrl: "https://www.liveatc.net/",
};

export const LIVEATC_SOURCE_PRIORITY = 100;

const LIVEATC_MEDIA_ORIGIN = "https://*.liveatc.net";
const CONFIG_ERROR_PREFIX = "Invalid ATC_CUSTOM_SOURCES_JSON";
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

type JsonObject = Record<string, unknown>;

type ParsedCustomProvider = AtcProviderAttribution;

interface ParsedCustomSource {
  id: string;
  providerId: string;
  feedIds: string[];
  streamUrl: string;
  priority: number;
  cors: boolean;
}

interface ParsedCustomConfig {
  providers: ParsedCustomProvider[];
  sources: ParsedCustomSource[];
}

export interface RegisteredAtcSource {
  id: string;
  providerId: string;
  streamUrl: string;
  relay: boolean;
}

export interface AtcSourceRegistry {
  providers: AtcProviderAttribution[];
  sourcesByFeed: Record<string, AtcSourceCandidate[]>;
  sourcesById: ReadonlyMap<string, RegisteredAtcSource>;
  mediaOrigins: string[];
}

function configError(message: string): never {
  throw new Error(`${CONFIG_ERROR_PREFIX}: ${message}`);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) {
    configError(`${path} must be an object.`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    configError(`${path} must be an array.`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    configError(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function requireId(value: unknown, path: string): string {
  const id = requireString(value, path);
  if (!ID_PATTERN.test(id)) {
    configError(
      `${path} must start with an alphanumeric character and contain only letters, numbers, '.', '_', ':', or '-'.`,
    );
  }
  return id;
}

function requireHttpsUrl(value: unknown, path: string): string {
  const rawUrl = requireString(value, path);
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    configError(`${path} must be a valid HTTPS URL.`);
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.hostname.includes("*") ||
    url.username ||
    url.password
  ) {
    configError(
      `${path} must be a concrete HTTPS URL without embedded credentials.`,
    );
  }

  return url.toString();
}

function requirePriority(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 1_000_000
  ) {
    configError(`${path} must be an integer between 0 and 1000000.`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    configError(`${path} must be a boolean.`);
  }
  return value;
}

function parseCustomConfig(rawConfig?: string): ParsedCustomConfig {
  if (rawConfig === undefined || rawConfig.trim() === "") {
    return { providers: [], sources: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    configError("value must be valid JSON.");
  }

  const config = requireObject(parsed, "value");
  const providerValues = requireArray(config.providers, "providers");
  const sourceValues = requireArray(config.sources, "sources");

  const providerIds = new Set<string>([LIVEATC_PROVIDER.id]);
  const providers = providerValues.map((value, index) => {
    const path = `providers[${index}]`;
    const provider = requireObject(value, path);
    const id = requireId(provider.id, `${path}.id`);

    if (providerIds.has(id)) {
      configError(`${path}.id duplicates provider ID '${id}'.`);
    }
    providerIds.add(id);

    return {
      id,
      label: requireString(provider.label, `${path}.label`),
      attributionUrl: requireHttpsUrl(
        provider.attributionUrl,
        `${path}.attributionUrl`,
      ),
    };
  });

  const knownFeedIds = new Set(
    Object.values(ATC_FEEDS)
      .flat()
      .map((feed) => feed.id),
  );
  const sourceIds = new Set<string>(
    [...knownFeedIds].map(getBuiltInAtcSourceId),
  );

  const sources = sourceValues.map((value, index) => {
    const path = `sources[${index}]`;
    const source = requireObject(value, path);
    const id = requireId(source.id, `${path}.id`);

    if (sourceIds.has(id)) {
      configError(`${path}.id duplicates source ID '${id}'.`);
    }
    sourceIds.add(id);

    const providerId = requireId(source.providerId, `${path}.providerId`);
    if (!providerIds.has(providerId)) {
      configError(
        `${path}.providerId references unknown provider '${providerId}'.`,
      );
    }

    const rawFeedIds = requireArray(source.feedIds, `${path}.feedIds`);
    if (rawFeedIds.length === 0) {
      configError(`${path}.feedIds must contain at least one feed ID.`);
    }

    const mappedFeedIds = new Set<string>();
    const feedIds = rawFeedIds.map((feedIdValue, feedIndex) => {
      const feedId = requireId(
        feedIdValue,
        `${path}.feedIds[${feedIndex}]`,
      );
      if (!knownFeedIds.has(feedId)) {
        configError(`${path}.feedIds references unknown feed '${feedId}'.`);
      }
      if (mappedFeedIds.has(feedId)) {
        configError(`${path}.feedIds contains duplicate feed '${feedId}'.`);
      }
      mappedFeedIds.add(feedId);
      return feedId;
    });

    return {
      id,
      providerId,
      feedIds,
      streamUrl: requireHttpsUrl(source.streamUrl, `${path}.streamUrl`),
      priority: requirePriority(source.priority, `${path}.priority`),
      cors: requireBoolean(source.cors, `${path}.cors`),
    };
  });

  return { providers, sources };
}

function playbackUrl(sourceId: string): string {
  return `/api/atc/stream?source=${encodeURIComponent(sourceId)}`;
}

function candidateFor(
  source: {
    id: string;
    providerId: string;
    priority: number;
    cors: boolean;
  },
  feedId: string,
  provider: AtcProviderAttribution,
): AtcSourceCandidate {
  return {
    id: source.id,
    feedId,
    providerId: provider.id,
    providerLabel: provider.label,
    attributionUrl: provider.attributionUrl,
    priority: source.priority,
    analyzable: source.cors,
    playbackUrl: playbackUrl(source.id),
  };
}

/** Build and validate an ATC source registry from an explicit JSON value. */
export function createAtcSourceRegistry(rawConfig?: string): AtcSourceRegistry {
  const customConfig = parseCustomConfig(rawConfig);
  const providers = [LIVEATC_PROVIDER, ...customConfig.providers];
  const providersById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  const sourcesById = new Map<string, RegisteredAtcSource>();
  const candidatesByFeed: Record<
    string,
    Array<{ candidate: AtcSourceCandidate; order: number }>
  > = {};
  const mediaOrigins = new Set<string>([LIVEATC_MEDIA_ORIGIN]);

  for (const feed of Object.values(ATC_FEEDS).flat()) {
    const mountPoint = getLiveAtcMountPoint(feed.id);
    if (!mountPoint) {
      throw new Error(`Missing built-in LiveATC source for feed '${feed.id}'.`);
    }

    const id = getBuiltInAtcSourceId(feed.id);
    const streamUrl = `https://d.liveatc.net/${encodeURIComponent(mountPoint)}`;
    sourcesById.set(id, {
      id,
      providerId: LIVEATC_PROVIDER.id,
      streamUrl,
      relay: true,
    });
    candidatesByFeed[feed.id] = [
      {
        candidate: candidateFor(
          {
            id,
            providerId: LIVEATC_PROVIDER.id,
            priority: LIVEATC_SOURCE_PRIORITY,
            cors: true,
          },
          feed.id,
          LIVEATC_PROVIDER,
        ),
        order: 0,
      },
    ];
  }

  customConfig.sources.forEach((source, index) => {
    const provider = providersById.get(source.providerId);
    if (!provider) {
      throw new Error(`Missing ATC provider '${source.providerId}'.`);
    }

    sourcesById.set(source.id, {
      id: source.id,
      providerId: source.providerId,
      streamUrl: source.streamUrl,
      relay: false,
    });
    mediaOrigins.add(new URL(source.streamUrl).origin);

    for (const feedId of source.feedIds) {
      candidatesByFeed[feedId].push({
        candidate: candidateFor(source, feedId, provider),
        order: index + 1,
      });
    }
  });

  const sourcesByFeed: Record<string, AtcSourceCandidate[]> = {};
  for (const [feedId, entries] of Object.entries(candidatesByFeed)) {
    sourcesByFeed[feedId] = entries
      .sort(
        (left, right) =>
          left.candidate.priority - right.candidate.priority ||
          left.order - right.order,
      )
      .map(({ candidate }) => candidate);
  }

  return {
    providers,
    sourcesByFeed,
    sourcesById,
    mediaOrigins: [...mediaOrigins],
  };
}

let cachedRawConfig: string | undefined;
let cachedRegistry: AtcSourceRegistry | undefined;
let hasCachedRegistry = false;

/** Return the deployment registry, rebuilding if the environment value changes. */
export function getAtcSourceRegistry(): AtcSourceRegistry {
  const rawConfig = process.env.ATC_CUSTOM_SOURCES_JSON;
  if (!hasCachedRegistry || rawConfig !== cachedRawConfig) {
    cachedRegistry = createAtcSourceRegistry(rawConfig);
    cachedRawConfig = rawConfig;
    hasCachedRegistry = true;
  }
  return cachedRegistry!;
}

export function getAtcProviderAttributions(): AtcProviderAttribution[] {
  return getAtcSourceRegistry().providers;
}

export function getAtcMediaOrigins(): string[] {
  return getAtcSourceRegistry().mediaOrigins;
}

export function resolveAtcSource(sourceId: string): RegisteredAtcSource | null {
  return getAtcSourceRegistry().sourcesById.get(sourceId) ?? null;
}

export const __internals = {
  parseCustomConfig,
};

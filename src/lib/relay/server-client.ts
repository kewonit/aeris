const RELAY_REQUEST_TIMEOUT_MS = 8_000;
const MAX_RELAY_RESPONSE_BYTES = 16 * 1024 * 1024;

export type RelayServerConfig = {
  origin: string;
  token: string;
};

export type RelayJsonResponse = {
  status: number;
  payload: unknown;
};

function normalizeRelayOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getRelayServerConfig(): RelayServerConfig | null {
  const origin = normalizeRelayOrigin(process.env.FLIGHT_DATA_ORIGIN);
  const token = process.env.FLIGHT_RELAY_HTTP_TOKEN?.trim();
  return origin && token ? { origin, token } : null;
}

export function directProviderAccessAuthorized(): boolean {
  return process.env.FLIGHT_DIRECT_PROVIDER_ACCESS === "authorized";
}

export async function fetchRelayJson(
  config: RelayServerConfig,
  pathname: string,
  searchParams: URLSearchParams,
  externalSignal?: AbortSignal,
): Promise<RelayJsonResponse> {
  if (!pathname.startsWith("/v1/")) {
    throw new Error("Invalid relay path");
  }
  const url = new URL(pathname, config.origin);
  url.search = searchParams.toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error("Relay returned a non-JSON response");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RELAY_RESPONSE_BYTES
    ) {
      throw new Error("Relay response exceeds the accepted size");
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_RELAY_RESPONSE_BYTES) {
      throw new Error("Relay response exceeds the accepted size");
    }
    return {
      status: response.status,
      payload: JSON.parse(new TextDecoder().decode(body)),
    };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

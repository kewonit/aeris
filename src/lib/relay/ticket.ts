import {
  createHash,
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";

import type { NextRequest } from "next/server";

import type { RelayAttribution } from "./protocol";

const TICKET_TTL_SECONDS = 60;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 20;
const MAX_RATE_BUCKETS = 10_000;
const ED25519_SEED_BYTES = 32;
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

type TicketClaims = {
  jti: string;
  exp: number;
  origin: string;
};

type RateBucket = {
  startedAt: number;
  count: number;
};

export type StreamTicketConfig = {
  privateKey: KeyObject;
  streamUrl: string;
  attribution: RelayAttribution | null;
};

const rateBuckets = new Map<string, RateBucket>();

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
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

function parseStreamUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "wss:" && url.protocol !== "ws:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parsePrivateKey(raw: string | undefined): KeyObject | null {
  if (!raw) return null;
  try {
    const bytes = Buffer.from(raw.trim(), "base64url");
    const der =
      bytes.length === ED25519_SEED_BYTES
        ? Buffer.concat([ED25519_PKCS8_PREFIX, bytes])
        : bytes;
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

function parseAttribution(): RelayAttribution | null {
  const provider = process.env.FLIGHT_DATA_ATTRIBUTION_PROVIDER?.trim();
  const label = process.env.FLIGHT_DATA_ATTRIBUTION_LABEL?.trim();
  const rawUrl = process.env.FLIGHT_DATA_ATTRIBUTION_URL?.trim();
  if (!provider && !label && !rawUrl) return null;

  let url: string | undefined;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        url = parsed.toString();
      }
    } catch {
      url = undefined;
    }
  }

  return {
    provider: provider || "authorized-source",
    ...(label ? { label } : {}),
    ...(url ? { url } : {}),
  };
}

export function getStreamTicketConfig(): StreamTicketConfig | null {
  const privateKey = parsePrivateKey(process.env.FLIGHT_STREAM_PRIVATE_KEY);
  const streamUrl = parseStreamUrl(
    process.env.NEXT_PUBLIC_FLIGHT_STREAM_URL,
  );
  if (!privateKey || !streamUrl) return null;
  return { privateKey, streamUrl, attribution: parseAttribution() };
}

export function expectedRequestOrigin(request: NextRequest): string | null {
  const configured = process.env.FLIGHT_APP_ORIGIN?.trim();
  if (configured) return normalizeOrigin(configured);
  return normalizeOrigin(request.nextUrl.origin);
}

export function validateTicketRequestOrigin(request: NextRequest): string | null {
  const expected = expectedRequestOrigin(request);
  const supplied = request.headers.get("origin");
  if (!expected || !supplied || normalizeOrigin(supplied) !== expected) {
    return null;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return null;
  return expected;
}

function ticketRateLimit(): number {
  const parsed = Number(process.env.FLIGHT_TICKET_ISSUE_LIMIT);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000
    ? parsed
    : DEFAULT_RATE_LIMIT;
}

function requestBucketKey(request: NextRequest): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";
  const address = forwarded.split(",", 1)[0].trim().slice(0, 128);
  return createHash("sha256").update(address).digest("base64url");
}

export function consumeTicketIssueLimit(
  request: NextRequest,
  now = Date.now(),
): boolean {
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
  }

  const key = requestBucketKey(request);
  const current = rateBuckets.get(key);
  if (!current) {
    if (rateBuckets.size >= MAX_RATE_BUCKETS) return false;
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= ticketRateLimit()) return false;
  current.count += 1;
  return true;
}

export function createStreamTicket(
  config: StreamTicketConfig,
  origin: string,
  options: { now?: number; id?: string } = {},
): { ticket: string; expiresAt: number } {
  const now = options.now ?? Date.now();
  const expiresAt = Math.floor(now / 1000) + TICKET_TTL_SECONDS;
  const claims: TicketClaims = {
    jti: options.id ?? randomUUID(),
    exp: expiresAt,
    origin,
  };
  const encodedPayload = base64url(JSON.stringify(claims));
  const signature = sign(null, Buffer.from(encodedPayload), config.privateKey);
  return {
    ticket: `${encodedPayload}.${base64url(signature)}`,
    expiresAt,
  };
}

export function clearTicketRateLimitsForTests(): void {
  rateBuckets.clear();
}

import { NextResponse, type NextRequest } from "next/server";
import { resolveAtcSource } from "@/lib/atc-source-registry";

const REDIRECT_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=120";
const CONNECT_TIMEOUT_MS = 12_000;
const MAX_STREAM_DURATION_MS = 4 * 60 * 60 * 1_000;

function jsonError(message: string, status: number): Response {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * GET /api/atc/stream?source={opaqueSourceId}
 *
 * Built-in LiveATC streams are relayed through Aeris. Their redirecting
 * Icecast endpoints are unreliable when used as cross-origin media sources,
 * and the same-origin response is required by the Web Audio visualizers.
 * Explicitly configured sources keep the direct-browser redirect path.
 */
export async function GET(request: NextRequest) {
  const sourceId = request.nextUrl.searchParams.get("source")?.trim();

  if (!sourceId) {
    return jsonError("Missing required 'source' parameter.", 400);
  }

  const source = resolveAtcSource(sourceId);
  if (!source) {
    return jsonError("Unknown ATC source.", 403);
  }

  if (!source.relay) {
    return new Response(null, {
      status: 307,
      headers: {
        Location: source.streamUrl,
        "Cache-Control": REDIRECT_CACHE_CONTROL,
        "Referrer-Policy": "no-referrer",
        "X-ATC-Provider": source.providerId,
      },
    });
  }

  const controller = new AbortController();
  let connectTimedOut = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    connectTimedOut = true;
    controller.abort();
  }, CONNECT_TIMEOUT_MS);
  const abortUpstream = () => controller.abort();
  request.signal.addEventListener("abort", abortUpstream, { once: true });

  try {
    const upstream = await fetch(source.streamUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "audio/mpeg, audio/*, */*",
        Referer: "https://www.liveatc.net/",
        "User-Agent": "Mozilla/5.0 (compatible; Aeris/1.0)",
      },
    });

    clearTimeout(connectTimer);
    connectTimer = null;

    if (!upstream.ok) {
      request.signal.removeEventListener("abort", abortUpstream);
      controller.abort();
      await upstream.body?.cancel().catch(() => {});
      return jsonError("Upstream stream unavailable.", 502);
    }

    if (!upstream.body) {
      request.signal.removeEventListener("abort", abortUpstream);
      controller.abort();
      return jsonError("Upstream stream returned no audio.", 502);
    }

    const reader = upstream.body.getReader();
    let finalized = false;
    let durationTimer: ReturnType<typeof setTimeout> | null = null;

    const finalize = (cancelReader = true) => {
      if (finalized) return;
      finalized = true;
      if (durationTimer) {
        clearTimeout(durationTimer);
        durationTimer = null;
      }
      request.signal.removeEventListener("abort", abortUpstream);
      controller.abort();
      if (cancelReader) void reader.cancel().catch(() => {});
    };

    durationTimer = setTimeout(finalize, MAX_STREAM_DURATION_MS);

    const stream = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          if (finalized) {
            streamController.close();
            return;
          }

          const { value, done } = await reader.read();
          if (done) {
            finalize(false);
            streamController.close();
            return;
          }

          streamController.enqueue(value);
        } catch {
          finalize();
          streamController.close();
        }
      },
      cancel() {
        finalize();
      },
    });

    return new Response(stream, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
        "X-Accel-Buffering": "no",
        "X-ATC-Provider": source.providerId,
      },
    });
  } catch (error) {
    if (connectTimer) clearTimeout(connectTimer);
    request.signal.removeEventListener("abort", abortUpstream);
    controller.abort();

    if (connectTimedOut) {
      return jsonError("Connection to upstream stream timed out.", 504);
    }
    if (request.signal.aborted) {
      return jsonError("ATC stream request was cancelled.", 499);
    }

    const aborted = error instanceof Error && error.name === "AbortError";
    return jsonError(
      aborted
        ? "Connection to upstream stream was interrupted."
        : "Failed to connect to upstream stream.",
      502,
    );
  }
}

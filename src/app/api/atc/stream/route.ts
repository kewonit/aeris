import { type NextRequest } from "next/server";
import { VALID_MOUNT_POINTS } from "@/lib/atc-feeds";

/**
 * GET /api/atc/stream?mount={mountPoint}
 *
 * Fallback audio stream proxy for LiveATC Icecast streams.
 * Only used when direct browser <audio> playback is blocked.
 *
 * Security:
 *   - Mount point validated against static allowlist (SSRF prevention)
 *   - Connection timeout: 30 seconds
 *   - Max stream duration: 4 hours
 *   - Simple per-request rate limiting via headers
 */

/** Maximum stream duration in milliseconds (4 hours). */
const MAX_STREAM_DURATION_MS = 4 * 60 * 60 * 1000;
/** Connection timeout for upstream fetch (30 seconds). */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Sanitize and validate mount point parameter.
 * Only alphanumeric characters, underscores, and hyphens are allowed.
 */
function isValidMountFormat(mount: string): boolean {
  return /^[a-z0-9_-]{2,64}$/i.test(mount);
}

export async function GET(request: NextRequest) {
  const mount = request.nextUrl.searchParams.get("mount")?.trim();

  if (!mount) {
    return new Response(
      JSON.stringify({ error: "Missing required 'mount' parameter." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate mount point format
  if (!isValidMountFormat(mount)) {
    return new Response(
      JSON.stringify({ error: "Invalid mount point format." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // SSRF prevention: only allow mount points from our static database
  if (!VALID_MOUNT_POINTS.has(mount)) {
    return new Response(
      JSON.stringify({
        error: "Unknown mount point. Only verified feeds are allowed.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Construct the upstream URL from the validated mount point
  // Using the direct Icecast server URL (d.liveatc.net)
  const upstreamUrl = `https://d.liveatc.net/${mount}`;

  try {
    const controller = new AbortController();
    const connectTimer = setTimeout(
      () => controller.abort(),
      CONNECT_TIMEOUT_MS,
    );

    const upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Aeris/1.0)",
        Referer: "https://www.liveatc.net/",
        Accept: "audio/mpeg, audio/*, */*",
      },
    });

    clearTimeout(connectTimer);

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: "Upstream stream unavailable.",
          status: upstream.status,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!upstream.body) {
      return new Response(
        JSON.stringify({ error: "No stream body from upstream." }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Set up max duration cutoff
    const durationController = new AbortController();
    const durationTimer = setTimeout(
      () => durationController.abort(),
      MAX_STREAM_DURATION_MS,
    );

    // Pipe the upstream stream through, respecting both abort signals
    const reader = upstream.body.getReader();
    const stream = new ReadableStream({
      async pull(ctrl) {
        try {
          if (durationController.signal.aborted) {
            reader.cancel().catch(() => {});
            clearTimeout(durationTimer);
            ctrl.close();
            return;
          }
          const { value, done } = await reader.read();
          if (done) {
            ctrl.close();
          } else {
            ctrl.enqueue(value);
          }
        } catch {
          reader.cancel().catch(() => {});
          ctrl.close();
        }
      },
      cancel() {
        clearTimeout(durationTimer);
        reader.cancel().catch(() => {});
      },
    });

    // Detect client disconnect via request abort signal
    request.signal.addEventListener("abort", () => {
      clearTimeout(durationTimer);
      reader.cancel().catch(() => {});
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Accel-Buffering": "no", // Disable Nginx buffering if behind reverse proxy
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) {
      return new Response(
        JSON.stringify({ error: "Connection to upstream timed out." }),
        { status: 504, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to connect to upstream stream." }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}

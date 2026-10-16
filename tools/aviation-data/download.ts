import { readFile } from "node:fs/promises";

const ATTEMPTS = 3;
const TIMEOUT_MS = 180_000;

/** Reads a local copy when one is given, otherwise downloads the source. */
export async function downloadSource(
  url: string,
  localFile?: string,
): Promise<Uint8Array> {
  if (localFile) return readFile(localFile);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        // The FAA registry rejects requests without a browser-like agent.
        headers: { "user-agent": "Mozilla/5.0 (compatible; aeris-data)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
  }
  throw lastError;
}

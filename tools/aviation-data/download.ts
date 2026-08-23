import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { normalizePublishedAt } from "./lib";

const execFileAsync = promisify(execFile);

export type Download = {
  bytes: Uint8Array;
  publishedAt: string | null;
};

export async function downloadSource(
  url: string,
  localFile?: string,
): Promise<Download> {
  if (localFile) {
    const [bytes, fileStat] = await Promise.all([
      readFile(localFile),
      stat(localFile),
    ]);
    return {
      bytes,
      publishedAt: normalizePublishedAt(fileStat.mtime.toUTCString()),
    };
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "aeris-aviation-data-"),
  );
  const dataPath = path.join(temporaryDirectory, "source.data");
  const headersPath = path.join(temporaryDirectory, "headers.txt");

  try {
    await execFileAsync(
      "curl",
      [
        "--location",
        "--fail",
        "--silent",
        "--show-error",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--retry-all-errors",
        "--connect-timeout",
        "20",
        "--max-time",
        "180",
        "--user-agent",
        "Mozilla/5.0",
        "--dump-header",
        headersPath,
        "--output",
        dataPath,
        url,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const [bytes, headers] = await Promise.all([
      readFile(dataPath),
      readFile(headersPath, "utf8"),
    ]);
    const modifiedHeaders = [...headers.matchAll(/^last-modified:\s*(.+)$/gim)];
    const lastModified = modifiedHeaders.at(-1)?.[1]?.trim() ?? null;
    return {
      bytes,
      publishedAt: normalizePublishedAt(lastModified),
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

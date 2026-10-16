import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVIATION_SCHEMA_VERSION,
  chunkIdForAddress,
  isAircraftChunk,
  isAircraftChunkIndex,
} from "../../src/lib/aircraft-registry-format";
import { sha256, type AviationDataManifest } from "./lib";

export const DATA_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/data/aviation",
);

const SOURCE_NAMES = ["faa", "mictronics"] as const;
export const EXCLUDED_FAA_FIELDS = [
  "owner name",
  "street address",
  "city",
  "state",
  "postal code",
  "county",
  "other names",
] as const;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function checkManifest(manifest: AviationDataManifest): void {
  if (manifest.schemaVersion !== AVIATION_SCHEMA_VERSION) {
    throw new Error("Aviation manifest has an unsupported schema version");
  }
  if (!isIsoDate(manifest.dataDate)) {
    throw new Error("Aviation manifest has an invalid data date");
  }
  if (!(manifest.counts?.aircraft >= 100_000)) {
    throw new Error("Aviation manifest record count is too small");
  }
  if (
    Object.keys(manifest.sources ?? {}).sort().join(",") !==
    SOURCE_NAMES.join(",")
  ) {
    throw new Error("Aviation manifest has invalid sources");
  }
  for (const name of SOURCE_NAMES) {
    const entry = manifest.sources[name];
    if (
      !entry.url?.startsWith("https://") ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      !isIsoDate(entry.retrievedAt) ||
      !entry.license?.trim() ||
      !entry.licenseUrl?.startsWith("https://") ||
      !entry.attribution?.trim() ||
      !Number.isInteger(entry.records) ||
      entry.records <= 0
    ) {
      throw new Error(`Aviation source metadata is invalid: ${name}`);
    }
  }
  if (
    EXCLUDED_FAA_FIELDS.some(
      (field) => !manifest.privacy?.excludedFaaFields?.includes(field),
    )
  ) {
    throw new Error("Aviation manifest has invalid privacy metadata");
  }
}

export async function checkAviationData(
  dataDirectory = DATA_DIRECTORY,
): Promise<AviationDataManifest> {
  const manifest = JSON.parse(
    await readFile(path.join(dataDirectory, "manifest.json"), "utf8"),
  ) as AviationDataManifest;
  checkManifest(manifest);

  const notice = await readFile(path.join(dataDirectory, "NOTICE.md"), "utf8");
  for (const name of SOURCE_NAMES) {
    const entry = manifest.sources[name];
    if (
      !notice.includes(entry.attribution) ||
      !notice.includes(`License: ${entry.license}.`)
    ) {
      throw new Error(`Aviation notice is incomplete: ${name}`);
    }
  }

  const aircraftDirectory = path.join(dataDirectory, "aircraft");
  const index: unknown = JSON.parse(
    await readFile(path.join(aircraftDirectory, "index.json"), "utf8"),
  );
  if (!isAircraftChunkIndex(index)) {
    throw new Error("Aircraft chunk index has an invalid shape");
  }
  const chunkIds = new Set(index.chunks);
  const sortedIds = [...index.chunks].sort();
  if (
    chunkIds.size !== index.chunks.length ||
    sortedIds.join(",") !== index.chunks.join(",")
  ) {
    throw new Error("Aircraft chunk index is not sorted and unique");
  }
  for (const id of index.chunks) {
    if (id.length === 3 && chunkIds.has(id.slice(0, 2))) {
      throw new Error(`Aircraft chunk overlaps its parent: ${id}`);
    }
  }

  const expectedFiles = index.chunks.map((id) => `${id}.json`);
  const actualFiles = (await readdir(aircraftDirectory))
    .filter((name) => name !== "index.json")
    .sort();
  if (actualFiles.join(",") !== expectedFiles.join(",")) {
    throw new Error("Aircraft chunk files do not match the index");
  }
  if (
    Object.keys(manifest.files ?? {}).sort().join(",") !==
    expectedFiles.join(",")
  ) {
    throw new Error("Aviation manifest files do not match the index");
  }

  let aircraftCount = 0;
  for (const id of index.chunks) {
    const fileName = `${id}.json`;
    const content = await readFile(path.join(aircraftDirectory, fileName), "utf8");
    const expected = manifest.files[fileName];
    if (sha256(content) !== expected.sha256) {
      throw new Error(`${fileName} hash does not match the manifest`);
    }
    const chunk: unknown = JSON.parse(content);
    if (!isAircraftChunk(chunk)) {
      throw new Error(`Aircraft chunk has an invalid shape: ${fileName}`);
    }
    const addresses = Object.keys(chunk.records);
    if (addresses.length === 0 || addresses.length !== expected.records) {
      throw new Error(`Aircraft chunk count is invalid: ${fileName}`);
    }
    for (const icao24 of addresses) {
      if (
        !/^[0-9a-f]{6}$/.test(icao24) ||
        chunkIdForAddress(icao24, chunkIds) !== id
      ) {
        throw new Error(`Aircraft is in the wrong chunk: ${icao24}`);
      }
    }
    aircraftCount += addresses.length;
  }
  if (aircraftCount !== manifest.counts.aircraft) {
    throw new Error("Aircraft total does not match the manifest");
  }
  return manifest;
}

async function main(): Promise<void> {
  try {
    const manifest = await checkAviationData();
    console.log(`Checked ${manifest.counts.aircraft} aircraft.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main();

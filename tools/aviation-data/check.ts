import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AIRCRAFT_CHUNK_COUNT,
  AVIATION_SCHEMA_VERSION,
  sha256,
  validateCompactAircraftRecord,
  type AircraftChunk,
  type AviationAirportRecord,
  type AviationDataManifest,
  type SourceManifestEntry,
} from "./lib";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DEFAULT_DATA_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "public/data/aviation",
);
const SOURCE_NAMES = ["faa", "mictronics", "ourairports"] as const;
const REQUIRED_PRIVACY_EXCLUSIONS = [
  "owner name",
  "street address",
  "city",
  "state",
  "postal code",
  "county",
  "other names",
] as const;

function checkHash(label: string, expected: string, content: string): void {
  if (content.includes("\u2014")) {
    throw new Error(`${label} contains an em dash character`);
  }
  const actual = sha256(content);
  if (actual !== expected) {
    throw new Error(`${label} hash does not match the manifest`);
  }
}

function checkSourceEntry(
  name: string,
  entry: SourceManifestEntry | undefined,
): asserts entry is SourceManifestEntry {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Aviation source is missing: ${name}`);
  }
  if (
    typeof entry.url !== "string" ||
    !entry.url.startsWith("https://") ||
    !/^[0-9a-f]{64}$/.test(entry.sha256) ||
    typeof entry.license !== "string" ||
    !entry.license.trim() ||
    typeof entry.licenseUrl !== "string" ||
    !entry.licenseUrl.startsWith("https://") ||
    typeof entry.attribution !== "string" ||
    !entry.attribution.trim() ||
    !Number.isInteger(entry.records) ||
    entry.records <= 0
  ) {
    throw new Error(`Aviation source metadata is invalid: ${name}`);
  }
  if (
    entry.publishedAt !== null &&
    (typeof entry.publishedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.publishedAt)))
  ) {
    throw new Error(`Aviation source date is invalid: ${name}`);
  }
}

function checkAirport(record: unknown): asserts record is AviationAirportRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Airport record has an invalid shape");
  }
  const value = record as Partial<AviationAirportRecord>;
  if (
    !Number.isInteger(value.id) ||
    typeof value.ident !== "string" ||
    !value.ident ||
    typeof value.type !== "string" ||
    typeof value.name !== "string" ||
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude)
  ) {
    throw new Error(`Airport record is invalid: ${value.ident ?? "unknown"}`);
  }
}

export async function checkAviationData(
  dataDirectory = DEFAULT_DATA_DIRECTORY,
): Promise<AviationDataManifest> {
  const manifestPath = path.join(dataDirectory, "manifest.json");
  const manifestContent = await readFile(manifestPath, "utf8");
  if (manifestContent.includes("\u2014")) {
    throw new Error("Aviation manifest contains an em dash character");
  }
  const manifest = JSON.parse(manifestContent) as AviationDataManifest;
  if (manifest.schemaVersion !== AVIATION_SCHEMA_VERSION) {
    throw new Error("Aviation manifest has an unsupported schema version");
  }
  if (
    manifest.dataDate !== null &&
    (typeof manifest.dataDate !== "string" ||
      !Number.isFinite(Date.parse(manifest.dataDate)))
  ) {
    throw new Error("Aviation manifest has an invalid data date");
  }
  if (manifest.counts.aircraft < 100_000 || manifest.counts.airports < 5_000) {
    throw new Error("Aviation manifest record counts are too small");
  }
  if (
    !manifest.sources ||
    typeof manifest.sources !== "object" ||
    Array.isArray(manifest.sources) ||
    Object.keys(manifest.sources).sort().join(",") !==
      [...SOURCE_NAMES].sort().join(",")
  ) {
    throw new Error("Aviation manifest has invalid sources");
  }
  for (const sourceName of SOURCE_NAMES) {
    checkSourceEntry(sourceName, manifest.sources[sourceName]);
  }
  if (
    !manifest.files?.aircraft ||
    typeof manifest.files.aircraft !== "object" ||
    Array.isArray(manifest.files.aircraft) ||
    Object.keys(manifest.files.aircraft).length !== AIRCRAFT_CHUNK_COUNT ||
    !manifest.files.airports ||
    typeof manifest.files.airports !== "object"
  ) {
    throw new Error("Aviation manifest has invalid file metadata");
  }
  if (
    !manifest.privacy ||
    !Array.isArray(manifest.privacy.includedAircraftFields) ||
    !Array.isArray(manifest.privacy.excludedFaaFields) ||
    REQUIRED_PRIVACY_EXCLUSIONS.some(
      (field) => !manifest.privacy.excludedFaaFields.includes(field),
    )
  ) {
    throw new Error("Aviation manifest has invalid privacy metadata");
  }

  const noticeContent = await readFile(
    path.join(dataDirectory, "NOTICE.md"),
    "utf8",
  );
  if (noticeContent.includes("\u2014")) {
    throw new Error("Aviation data notice contains an em dash character");
  }
  for (const sourceName of SOURCE_NAMES) {
    const entry = manifest.sources[sourceName];
    if (
      !noticeContent.includes(entry.attribution) ||
      !noticeContent.includes(`License: ${entry.license}.`)
    ) {
      throw new Error(`Aviation notice is incomplete: ${sourceName}`);
    }
  }

  const aircraftDirectory = path.join(dataDirectory, "aircraft");
  const aircraftFiles = (await readdir(aircraftDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (aircraftFiles.length !== AIRCRAFT_CHUNK_COUNT) {
    throw new Error(
      `Expected ${AIRCRAFT_CHUNK_COUNT} aircraft chunks, found ${aircraftFiles.length}`,
    );
  }

  let aircraftCount = 0;
  for (let index = 0; index < AIRCRAFT_CHUNK_COUNT; index++) {
    const prefix = index.toString(16).padStart(2, "0");
    const fileName = `${prefix}.json`;
    if (aircraftFiles[index] !== fileName) {
      throw new Error(`Aircraft chunk is missing: ${fileName}`);
    }
    const content = await readFile(path.join(aircraftDirectory, fileName), "utf8");
    const expected = manifest.files.aircraft[fileName];
    if (!expected) throw new Error(`Manifest entry is missing: ${fileName}`);
    checkHash(fileName, expected.sha256, content);
    const chunk = JSON.parse(content) as AircraftChunk;
    if (chunk.schemaVersion !== AVIATION_SCHEMA_VERSION) {
      throw new Error(`Aircraft chunk has an invalid version: ${fileName}`);
    }
    const entries = Object.entries(chunk.records);
    if (entries.length !== expected.records) {
      throw new Error(`Aircraft chunk count is invalid: ${fileName}`);
    }
    for (const [icao24, record] of entries) {
      if (!new RegExp(`^${prefix}[0-9a-f]{4}$`).test(icao24)) {
        throw new Error(`Aircraft is in the wrong chunk: ${icao24}`);
      }
      validateCompactAircraftRecord(icao24, record);
    }
    aircraftCount += entries.length;
  }
  if (aircraftCount !== manifest.counts.aircraft) {
    throw new Error("Aircraft total does not match the manifest");
  }

  const airportsContent = await readFile(
    path.join(dataDirectory, "airports.json"),
    "utf8",
  );
  checkHash("airports.json", manifest.files.airports.sha256, airportsContent);
  const airportFile = JSON.parse(airportsContent) as {
    schemaVersion: number;
    records: unknown[];
  };
  if (
    airportFile.schemaVersion !== AVIATION_SCHEMA_VERSION ||
    !Array.isArray(airportFile.records)
  ) {
    throw new Error("Airport file has an invalid shape");
  }
  let previousAirport: AviationAirportRecord | null = null;
  for (const record of airportFile.records) {
    checkAirport(record);
    const identOrder = previousAirport?.ident.localeCompare(record.ident) ?? -1;
    if (
      previousAirport &&
      (identOrder > 0 || (identOrder === 0 && previousAirport.id > record.id))
    ) {
      throw new Error("Airport file is not sorted");
    }
    previousAirport = record;
  }
  if (
    airportFile.records.length !== manifest.files.airports.records ||
    airportFile.records.length !== manifest.counts.airports
  ) {
    throw new Error("Airport total does not match the manifest");
  }
  return manifest;
}

async function main(): Promise<void> {
  try {
    const manifest = await checkAviationData();
    console.log(
      `Checked ${manifest.counts.aircraft} aircraft and ${manifest.counts.airports} airports.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main();

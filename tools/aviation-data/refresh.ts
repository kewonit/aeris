import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AVIATION_SCHEMA_VERSION } from "../../src/lib/aircraft-registry-format";
import { checkAviationData, DATA_DIRECTORY, EXCLUDED_FAA_FIELDS } from "./check";
import { downloadSource } from "./download";
import {
  createAircraftChunks,
  mergeFaaAircraft,
  normalizeMictronicsAircraft,
  serializeJson,
  sha256,
  validateCountChange,
  type AviationDataManifest,
  type SourceManifestEntry,
} from "./lib";

const STAGING_DIRECTORY = `${DATA_DIRECTORY}.next`;
const PREVIOUS_DIRECTORY = `${DATA_DIRECTORY}.previous`;

const SOURCES = {
  mictronics:
    "https://raw.githubusercontent.com/Mictronics/aircraft-database/main/aircraft_db.zip",
  faa: "https://registry.faa.gov/database/ReleasableAircraft.zip",
} as const;

async function readPreviousManifest(): Promise<AviationDataManifest | null> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(DATA_DIRECTORY, "manifest.json"), "utf8"),
    ) as AviationDataManifest;
    return manifest.schemaVersion === AVIATION_SCHEMA_VERSION ? manifest : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function retrievedAt(
  hash: string,
  previous: SourceManifestEntry | undefined,
  now: string,
): string {
  // Keep the date stable while the source file is unchanged, so a rerun
  // over the same inputs writes identical files.
  return previous?.sha256 === hash ? previous.retrievedAt : now;
}

export async function refreshAviationData(): Promise<AviationDataManifest> {
  const previous = await readPreviousManifest();
  const now = new Date().toISOString();
  const [mictronicsBytes, faaBytes] = await Promise.all([
    downloadSource(SOURCES.mictronics, process.env.AERIS_MICTRONICS_SOURCE_FILE),
    downloadSource(SOURCES.faa, process.env.AERIS_FAA_SOURCE_FILE),
  ]);

  const aircraft = normalizeMictronicsAircraft(mictronicsBytes);
  const mictronicsRecords = aircraft.size;
  const faaRecords = mergeFaaAircraft(faaBytes, aircraft);
  validateCountChange("Mictronics", previous?.sources.mictronics.records, mictronicsRecords);
  validateCountChange("FAA", previous?.sources.faa.records, faaRecords);
  validateCountChange("Aircraft", previous?.counts.aircraft, aircraft.size);

  const chunks = createAircraftChunks(aircraft);
  const chunkFiles = new Map<string, string>();
  const files: AviationDataManifest["files"] = {};
  for (const [id, chunk] of chunks) {
    const content = serializeJson(chunk);
    chunkFiles.set(`${id}.json`, content);
    files[`${id}.json`] = {
      sha256: sha256(content),
      records: Object.keys(chunk.records).length,
    };
  }

  const mictronicsHash = sha256(mictronicsBytes);
  const faaHash = sha256(faaBytes);
  const sources: AviationDataManifest["sources"] = {
    faa: {
      url: SOURCES.faa,
      sha256: faaHash,
      retrievedAt: retrievedAt(faaHash, previous?.sources.faa, now),
      license: "United States government public data",
      licenseUrl:
        "https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download",
      attribution: "Source: Federal Aviation Administration aircraft registry.",
      records: faaRecords,
    },
    mictronics: {
      url: SOURCES.mictronics,
      sha256: mictronicsHash,
      retrievedAt: retrievedAt(mictronicsHash, previous?.sources.mictronics, now),
      license: "Open Data Commons Attribution License",
      licenseUrl:
        "https://github.com/Mictronics/aircraft-database/blob/main/LICENSE",
      attribution: "Contains information from the Mictronics Aircraft Database.",
      records: mictronicsRecords,
    },
  };

  const manifest: AviationDataManifest = {
    schemaVersion: AVIATION_SCHEMA_VERSION,
    dataDate: [sources.faa.retrievedAt, sources.mictronics.retrievedAt].sort()[1],
    sources,
    files,
    counts: { aircraft: aircraft.size },
    privacy: {
      includedAircraftFields: [
        "ICAO address",
        "registration",
        "ICAO type code",
        "model",
        "manufacturer",
        "database flags",
        "data sources",
      ],
      excludedFaaFields: [...EXCLUDED_FAA_FIELDS],
    },
  };

  await rm(STAGING_DIRECTORY, { recursive: true, force: true });
  await mkdir(path.join(STAGING_DIRECTORY, "aircraft"), { recursive: true });
  for (const [fileName, content] of chunkFiles) {
    await writeFile(path.join(STAGING_DIRECTORY, "aircraft", fileName), content);
  }
  await writeFile(
    path.join(STAGING_DIRECTORY, "aircraft", "index.json"),
    serializeJson({ schemaVersion: AVIATION_SCHEMA_VERSION, chunks: [...chunks.keys()] }),
  );
  await writeFile(path.join(STAGING_DIRECTORY, "manifest.json"), serializeJson(manifest));
  await copyFile(
    path.join(DATA_DIRECTORY, "NOTICE.md"),
    path.join(STAGING_DIRECTORY, "NOTICE.md"),
  );

  try {
    await checkAviationData(STAGING_DIRECTORY);
  } catch (error) {
    await rm(STAGING_DIRECTORY, { recursive: true, force: true });
    throw error;
  }

  await rm(PREVIOUS_DIRECTORY, { recursive: true, force: true });
  await rename(DATA_DIRECTORY, PREVIOUS_DIRECTORY);
  await rename(STAGING_DIRECTORY, DATA_DIRECTORY);
  await rm(PREVIOUS_DIRECTORY, { recursive: true, force: true });
  return manifest;
}

async function main(): Promise<void> {
  try {
    const manifest = await refreshAviationData();
    console.log(
      `Wrote ${manifest.counts.aircraft} aircraft in ${Object.keys(manifest.files).length} chunks.`,
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

import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVIATION_SCHEMA_VERSION,
  createAircraftChunks,
  latestSourceDate,
  mergeFaaAircraft,
  normalizeAirports,
  normalizeMictronicsAircraft,
  serializeJson,
  sha256,
  validateCountChange,
  type AviationDataManifest,
  type SourceManifestEntry,
} from "./lib";
import { checkAviationData } from "./check";
import { downloadSource, type Download } from "./download";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "public/data/aviation",
);
const AIRCRAFT_DIRECTORY = path.join(DATA_DIRECTORY, "aircraft");
const MANIFEST_PATH = path.join(DATA_DIRECTORY, "manifest.json");
const AIRPORTS_PATH = path.join(DATA_DIRECTORY, "airports.json");
const NOTICE_PATH = path.join(DATA_DIRECTORY, "NOTICE.md");

const SOURCES = {
  mictronics:
    "https://raw.githubusercontent.com/Mictronics/aircraft-database/main/aircraft_db.zip",
  faa: "https://registry.faa.gov/database/ReleasableAircraft.zip",
  ourairports: "https://ourairports.com/data/airports.csv",
} as const;

async function readPreviousManifest(): Promise<AviationDataManifest | null> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as AviationDataManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function stablePublishedAt(
  download: Download,
  previous: SourceManifestEntry | undefined,
): string | null {
  const hash = sha256(download.bytes);
  if (previous?.sha256 === hash) return previous.publishedAt;
  return download.publishedAt;
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.next`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

export async function refreshAviationData(): Promise<AviationDataManifest> {
  const previous = await readPreviousManifest();
  const [mictronicsDownload, faaDownload, airportsDownload] =
    await Promise.all([
      downloadSource(
        SOURCES.mictronics,
        process.env.AERIS_MICTRONICS_SOURCE_FILE,
      ),
      downloadSource(SOURCES.faa, process.env.AERIS_FAA_SOURCE_FILE),
      downloadSource(
        SOURCES.ourairports,
        process.env.AERIS_AIRPORTS_SOURCE_FILE,
      ),
    ]);

  const aircraft = normalizeMictronicsAircraft(mictronicsDownload.bytes);
  const mictronicsRecordCount = aircraft.size;
  const faaRecordCount = mergeFaaAircraft(faaDownload.bytes, aircraft);
  const airports = normalizeAirports(
    new TextDecoder("utf-8").decode(airportsDownload.bytes),
  );

  validateCountChange(
    "Mictronics",
    previous?.sources.mictronics.records,
    mictronicsRecordCount,
  );
  validateCountChange(
    "FAA",
    previous?.sources.faa.records,
    faaRecordCount,
  );
  validateCountChange(
    "OurAirports",
    previous?.sources.ourairports.records,
    airports.length,
  );
  validateCountChange(
    "Aircraft",
    previous?.counts.aircraft,
    aircraft.size,
  );
  validateCountChange("Airport", previous?.counts.airports, airports.length);

  const chunks = createAircraftChunks(aircraft);
  const chunkOutput = new Map<string, string>();
  const aircraftFiles: Record<string, { sha256: string; records: number }> = {};
  for (const [prefix, chunk] of chunks) {
    const content = serializeJson(chunk);
    chunkOutput.set(prefix, content);
    aircraftFiles[`${prefix}.json`] = {
      sha256: sha256(content),
      records: Object.keys(chunk.records).length,
    };
  }

  const airportsContent = serializeJson({
    schemaVersion: AVIATION_SCHEMA_VERSION,
    records: airports,
  });
  const sourceEntries = {
    mictronics: {
      url: SOURCES.mictronics,
      sha256: sha256(mictronicsDownload.bytes),
      publishedAt: stablePublishedAt(
        mictronicsDownload,
        previous?.sources.mictronics,
      ),
      license: "Open Data Commons Attribution License",
      licenseUrl:
        "https://github.com/Mictronics/aircraft-database/blob/main/LICENSE",
      attribution:
        "Contains information from the Mictronics Aircraft Database.",
      records: mictronicsRecordCount,
    },
    faa: {
      url: SOURCES.faa,
      sha256: sha256(faaDownload.bytes),
      publishedAt: stablePublishedAt(faaDownload, previous?.sources.faa),
      license: "United States government public data",
      licenseUrl:
        "https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download",
      attribution: "Source: Federal Aviation Administration aircraft registry.",
      records: faaRecordCount,
    },
    ourairports: {
      url: SOURCES.ourairports,
      sha256: sha256(airportsDownload.bytes),
      publishedAt: stablePublishedAt(
        airportsDownload,
        previous?.sources.ourairports,
      ),
      license: "Public domain",
      licenseUrl: "https://ourairports.com/data/",
      attribution: "Source: OurAirports.",
      records: airports.length,
    },
  } satisfies AviationDataManifest["sources"];

  const manifest: AviationDataManifest = {
    schemaVersion: AVIATION_SCHEMA_VERSION,
    dataDate: latestSourceDate(Object.values(sourceEntries)),
    sources: sourceEntries,
    files: {
      aircraft: aircraftFiles,
      airports: {
        sha256: sha256(airportsContent),
        records: airports.length,
      },
    },
    counts: {
      aircraft: aircraft.size,
      airports: airports.length,
    },
    privacy: {
      includedAircraftFields: [
        "ICAO address",
        "registration",
        "ICAO type code",
        "model",
        "manufacturer",
        "registration country code",
        "database flags",
        "data sources",
      ],
      excludedFaaFields: [
        "owner name",
        "street address",
        "city",
        "state",
        "postal code",
        "county",
        "other names",
      ],
    },
  };

  const validationDirectory = await mkdtemp(
    path.join(tmpdir(), "aeris-aviation-output-"),
  );
  const validationAircraftDirectory = path.join(
    validationDirectory,
    "aircraft",
  );
  try {
    await mkdir(validationAircraftDirectory, { recursive: true });
    for (const [prefix, content] of chunkOutput) {
      await writeFile(
        path.join(validationAircraftDirectory, `${prefix}.json`),
        content,
        "utf8",
      );
    }
    await writeFile(
      path.join(validationDirectory, "airports.json"),
      airportsContent,
      "utf8",
    );
    await writeFile(
      path.join(validationDirectory, "manifest.json"),
      serializeJson(manifest),
      "utf8",
    );
    await writeFile(
      path.join(validationDirectory, "NOTICE.md"),
      await readFile(NOTICE_PATH, "utf8"),
      "utf8",
    );
    await checkAviationData(validationDirectory);

    await mkdir(AIRCRAFT_DIRECTORY, { recursive: true });
    for (const [prefix, content] of chunkOutput) {
      await writeAtomic(
        path.join(AIRCRAFT_DIRECTORY, `${prefix}.json`),
        content,
      );
    }
    await writeAtomic(AIRPORTS_PATH, airportsContent);
    await writeAtomic(MANIFEST_PATH, serializeJson(manifest));
  } finally {
    await rm(validationDirectory, { recursive: true, force: true });
  }
  await checkAviationData(DATA_DIRECTORY);
  return manifest;
}

async function main(): Promise<void> {
  try {
    const manifest = await refreshAviationData();
    console.log(
      `Wrote ${manifest.counts.aircraft} aircraft and ${manifest.counts.airports} airports.`,
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

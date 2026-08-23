import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { downloadSource } from "./download";
import {
  mergeFaaAircraft,
  normalizeAirports,
  validateCountChange,
  type AviationDataManifest,
} from "./lib";

const FAA_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip";
const AIRPORTS_URL = "https://ourairports.com/data/airports.csv";
const MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/data/aviation/manifest.json",
);

export async function checkFastSources(): Promise<{
  faaRecords: number;
  airportRecords: number;
}> {
  const [faa, airports] = await Promise.all([
    downloadSource(FAA_URL, process.env.AERIS_FAA_SOURCE_FILE),
    downloadSource(AIRPORTS_URL, process.env.AERIS_AIRPORTS_SOURCE_FILE),
  ]);
  const faaRecords = mergeFaaAircraft(faa.bytes, new Map());
  const airportRecords = normalizeAirports(
    new TextDecoder("utf-8").decode(airports.bytes),
  ).length;
  const manifest = JSON.parse(
    await readFile(MANIFEST_PATH, "utf8"),
  ) as AviationDataManifest;
  validateCountChange("FAA", manifest.sources.faa.records, faaRecords);
  validateCountChange(
    "OurAirports",
    manifest.sources.ourairports.records,
    airportRecords,
  );
  return { faaRecords, airportRecords };
}

async function main(): Promise<void> {
  try {
    const result = await checkFastSources();
    console.log(
      `Checked ${result.faaRecords} FAA records and ${result.airportRecords} airport records.`,
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

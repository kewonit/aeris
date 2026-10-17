import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import { fpvHeightOffsetMeters } from "./fpv-height";

const FEET = 0.3048;
// O'Hare's reference point, listed at 680 ft.
const ORD = { latitude: 41.9786, longitude: -87.9048 };
const ORD_ELEVATION = 680 * FEET;

function flight(overrides: Partial<FlightState>): FlightState {
  return {
    icao24: "abc123",
    longitude: ORD.longitude,
    latitude: ORD.latitude,
    baroAltitude: 1_000 * FEET,
    geoAltitude: null,
    navQnh: null,
    onGround: false,
    ...overrides,
  } as FlightState;
}

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.5, `${actual} vs ${expected}`);

test("near the ground, takes off the airport's height and puts the altimeter setting back", () => {
  // QNH 1031 hPa: the aircraft is 146 m higher than its pressure altitude.
  const offset = fpvHeightOffsetMeters(flight({ navQnh: 1_031 }));
  close(offset, (1_031 - 1_013.25) * 8.23 - ORD_ELEVATION);
  // On the runway its pressure altitude reads 479 ft below the field's,
  // and it is drawn on the ground, not hundreds of metres up.
  const onRunway = flight({
    baroAltitude: ORD_ELEVATION - (1_031 - 1_013.25) * 8.23,
    navQnh: 1_031,
  });
  close(onRunway.baroAltitude! + fpvHeightOffsetMeters(onRunway), 0);
});

test("without a local altimeter setting, uses the satellite altitude", () => {
  const standard = flight({ navQnh: 1_013.2, geoAltitude: 1_300 * FEET });
  close(fpvHeightOffsetMeters(standard), 300 * FEET - ORD_ELEVATION);
  const neither = flight({});
  close(fpvHeightOffsetMeters(neither), -ORD_ELEVATION);
});

test("fades out with height, and is nothing at cruise or away from airports", () => {
  const halfway = flight({ baroAltitude: (680 + 6_500) * FEET });
  close(fpvHeightOffsetMeters(halfway), -ORD_ELEVATION / 2);
  const cruising = flight({ baroAltitude: 35_000 * FEET });
  assert.equal(fpvHeightOffsetMeters(cruising), 0);
  const overLakeMichigan = flight({ latitude: 43.5, longitude: -87 });
  assert.equal(fpvHeightOffsetMeters(overLakeMichigan), 0);
  assert.equal(fpvHeightOffsetMeters(null), 0);
});

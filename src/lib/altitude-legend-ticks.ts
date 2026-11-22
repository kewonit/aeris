import type { UnitSystem } from "@/hooks/use-settings";

const METERS_PER_FOOT = 0.3048;

/** Round heights in each unit, from the top of the key to the ground. */
const FEET_TICKS = [40_000, 20_000, 10_000, 5_000, 2_000, 500, 0];
const METRE_TICKS = [12_000, 6_000, 3_000, 1_500, 600, 150, 0];

/**
 * The altitude key's heights in metres, top to bottom, chosen to be round
 * in the unit shown: 40,000 to 500 ft, or 12,000 to 150 m. Feet convert to
 * metres exactly, so formatting them back gives the same round number.
 */
export function legendTicksMeters(unitSystem: UnitSystem): number[] {
  return unitSystem === "metric"
    ? [...METRE_TICKS]
    : FEET_TICKS.map((feet) => feet * METERS_PER_FOOT);
}
